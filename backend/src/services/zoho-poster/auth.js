// src/services/zoho-poster/auth.js — Zoho OAuth token management
// R04 mitigation: proactive refresh at T-10min, 5-min health probe, pause pipeline on auth death

const axios = require('axios');
const config = require('../../../config');
const { query } = require('../../infra/db/pool');

let tokenState = {
  accessToken: null,
  expiresAt: null,
  refreshing: false,
};

async function getAccessToken() {
  if (tokenState.accessToken && tokenState.expiresAt > Date.now() + 60000) {
    return tokenState.accessToken;
  }
  return await refreshToken();
}

async function refreshToken() {
  if (tokenState.refreshing) {
    // Wait for in-flight refresh
    await new Promise(resolve => setTimeout(resolve, 2000));
    return tokenState.accessToken;
  }

  tokenState.refreshing = true;
  try {
    const resp = await axios.post('https://accounts.zoho.in/oauth/v2/token', null, {
      params: {
        refresh_token: config.zoho.refreshToken,
        client_id: config.zoho.clientId,
        client_secret: config.zoho.clientSecret,
        grant_type: 'refresh_token',
      },
    });

    if (resp.data.access_token) {
      tokenState.accessToken = resp.data.access_token;
      tokenState.expiresAt = Date.now() + (resp.data.expires_in || 3600) * 1000;
      config.zoho.accessToken = tokenState.accessToken;

      await updateSystemState('healthy');
      console.log(`[ZOHO-AUTH] Token refreshed, expires in ${resp.data.expires_in}s`);
      return tokenState.accessToken;
    }
    throw new Error('No access_token in response');
  } catch (err) {
    console.error('[ZOHO-AUTH] Token refresh FAILED:', err.message);
    await updateSystemState('auth_failed', err.message);
    return null;
  } finally {
    tokenState.refreshing = false;
  }
}

// ── 5-minute health probe (R04) ──

async function healthProbe() {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { healthy: false, reason: 'no_token' };
    }

    const resp = await axios.get(
      `${config.zoho.baseUrl}/organization?organization_id=${config.zoho.orgId}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, timeout: 10000 }
    );

    if (resp.status === 200) {
      await updateSystemState('healthy');
      return { healthy: true, orgName: resp.data?.organization?.name };
    }
    return { healthy: false, reason: `status_${resp.status}` };
  } catch (err) {
    if (err.response?.status === 401) {
      console.error('[ZOHO-AUTH] 401 on health probe — attempting refresh');
      tokenState.accessToken = null;
      const newToken = await refreshToken();
      if (newToken) {
        return { healthy: true, reason: 'recovered_after_refresh' };
      }
      await updateSystemState('auth_dead', 'Health probe 401, refresh failed');
      return { healthy: false, reason: 'auth_dead' };
    }
    return { healthy: false, reason: err.message };
  }
}

// ── Proactive refresh at T-10min ──

async function proactiveRefresh() {
  if (!tokenState.expiresAt) return;
  const timeToExpiry = tokenState.expiresAt - Date.now();
  if (timeToExpiry < 10 * 60 * 1000 && timeToExpiry > 0) {
    console.log('[ZOHO-AUTH] Token expiring in <10min — proactive refresh');
    await refreshToken();
  }
}

async function updateSystemState(status, error) {
  try {
    await query(
      `UPDATE system_state SET value = $1, updated_at = NOW() WHERE key = 'zoho_auth'`,
      [JSON.stringify({ status, last_check: new Date().toISOString(), error: error || null })]
    );
  } catch (e) { /* non-critical */ }
}

function getTokenState() {
  return {
    hasToken: !!tokenState.accessToken,
    expiresIn: tokenState.expiresAt ? Math.round((tokenState.expiresAt - Date.now()) / 1000) : null,
  };
}

module.exports = { getAccessToken, refreshToken, healthProbe, proactiveRefresh, getTokenState };
