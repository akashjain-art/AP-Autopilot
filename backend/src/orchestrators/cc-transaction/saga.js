// src/orchestrators/cc-transaction/saga.js — Saga pattern for CC 3-step pipeline
// R01 mitigation: if step 2 fails, auto-reverse step 1. If step 3 fails, keep 1+2 but flag.
// Each step has a compensating action. Idempotency keys prevent duplicates on retry.

const zohoPost = require('../../services/zoho-poster');
const audit = require('../../services/audit-logger');

class CCSaga {
  constructor(correlationId, transactionData) {
    this.correlationId = correlationId;
    this.txn = transactionData;
    this.state = {
      step1: { status: 'pending', zohoId: null },  // vendor bill
      step2: { status: 'pending', zohoId: null },  // CC journal
      step3: { status: 'pending', zohoId: null },  // settlement
    };
    this.completed = false;
    this.failed = false;
    this.failedAt = null;
    this.compensated = false;
  }

  // ── Execute the full 3-step pipeline ──
  async execute() {
    try {
      // Step 1: Create vendor bill
      await this.step1_createBill();

      // Step 2: Create CC journal entry
      await this.step2_createJournal();

      // Step 3: Settlement (knock-off bill against journal)
      await this.step3_settlement();

      this.completed = true;
      await audit.logPipelineStep(this.correlationId, 'A3', 'saga_complete', 'All 3 steps succeeded');
      return this.getResult();

    } catch (err) {
      this.failed = true;
      console.error(`[SAGA] ${this.correlationId} failed at step ${this.failedAt}: ${err.message}`);

      // Compensate based on where we failed
      await this.compensate();

      await audit.logServiceCall(
        this.correlationId, 'A3', 'saga_failed',
        { failedAt: this.failedAt, state: this.state },
        { compensated: this.compensated },
        0, err.message
      );

      return this.getResult();
    }
  }

  // ── Step 1: Create vendor bill with RCM if applicable ──
  async step1_createBill() {
    const idempotencyKey = `HSBC-${this.txn.id}-bill`;
    try {
      const result = await zohoPost.post({
        entryType: 'bill',
        payload: this.txn.billPayload,
        idempotencyKey,
        correlationId: this.correlationId,
        billEnteredAt: this.txn.enteredAt,
      });
      this.state.step1 = { status: 'completed', zohoId: result.zohoId };
      await audit.logPipelineStep(this.correlationId, 'A3', 'saga_step1', `Bill created: ${result.zohoId}`);
    } catch (err) {
      this.failedAt = 'step1';
      this.state.step1 = { status: 'failed', error: err.message };
      throw err;
    }
  }

  // ── Step 2: Create CC journal entry (Dr vendor / Cr CC account) ──
  async step2_createJournal() {
    const idempotencyKey = `HSBC-${this.txn.id}-journal`;
    try {
      const result = await zohoPost.post({
        entryType: 'journal',
        payload: this.txn.journalPayload,
        idempotencyKey,
        correlationId: this.correlationId,
        billEnteredAt: this.txn.enteredAt,
      });
      this.state.step2 = { status: 'completed', zohoId: result.zohoId };
      await audit.logPipelineStep(this.correlationId, 'A3', 'saga_step2', `Journal created: ${result.zohoId}`);
    } catch (err) {
      this.failedAt = 'step2';
      this.state.step2 = { status: 'failed', error: err.message };
      throw err;
    }
  }

  // ── Step 3: Settlement — match bill to journal ──
  async step3_settlement() {
    const idempotencyKey = `HSBC-${this.txn.id}-settle`;
    try {
      const result = await zohoPost.post({
        entryType: 'payment',
        payload: {
          vendor_id: this.txn.vendorId,
          amount: this.txn.amount,
          payment_mode: 'Credit Card',
          bills: [{ bill_id: this.state.step1.zohoId, amount_applied: this.txn.amount }],
          reference_number: this.correlationId,
        },
        idempotencyKey,
        correlationId: this.correlationId,
        billEnteredAt: this.txn.enteredAt,
      });
      this.state.step3 = { status: 'completed', zohoId: result.zohoId };
      await audit.logPipelineStep(this.correlationId, 'A3', 'saga_step3', `Settlement applied: ${result.zohoId}`);
    } catch (err) {
      this.failedAt = 'step3';
      this.state.step3 = { status: 'failed', error: err.message };
      throw err;
    }
  }

  // ── Compensation: undo completed steps when a later step fails ──
  async compensate() {
    try {
      if (this.failedAt === 'step1') {
        // Nothing to compensate — step 1 failed, nothing was created
        this.compensated = true;
        return;
      }

      if (this.failedAt === 'step2') {
        // Step 1 succeeded, step 2 failed → void the bill from step 1
        if (this.state.step1.zohoId) {
          console.log(`[SAGA] Compensating: voiding bill ${this.state.step1.zohoId}`);
          await zohoPost.voidBill(this.state.step1.zohoId);
          this.state.step1 = { status: 'compensated', zohoId: this.state.step1.zohoId };
        }
        this.compensated = true;
        return;
      }

      if (this.failedAt === 'step3') {
        // Steps 1+2 succeeded, step 3 (settlement) failed
        // DON'T void steps 1+2 — the bill and journal are valid entries
        // Just flag for manual settlement
        console.log(`[SAGA] Step 3 failed — keeping bill+journal, flagging for manual settlement`);
        this.state.step3 = { status: 'manual_settlement_needed', error: this.state.step3.error };
        this.compensated = false; // Not fully compensated — needs human action
        return;
      }
    } catch (compensationErr) {
      console.error(`[SAGA] Compensation FAILED: ${compensationErr.message}`);
      this.compensated = false;
      // This is the worst case — partial state. Route to Q9 (dead letter) if it existed.
    }
  }

  getResult() {
    return {
      correlationId: this.correlationId,
      completed: this.completed,
      failed: this.failed,
      failedAt: this.failedAt,
      compensated: this.compensated,
      state: this.state,
      billId: this.state.step1.zohoId,
      journalId: this.state.step2.zohoId,
      paymentId: this.state.step3.zohoId,
      needsManualAction: this.failed && !this.compensated,
    };
  }
}

module.exports = { CCSaga };
