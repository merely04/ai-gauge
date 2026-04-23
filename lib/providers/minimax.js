import { registerProvider } from './index.js';

const minimaxAdapter = {
  name: 'minimax',
  kind: 'api-key',

  buildRequest(creds, { baseUrl } = {}) {
    if (!creds?.token) throw new Error('minimax: missing token');
    if (!baseUrl) throw new Error('minimax: missing baseUrl');

    const origin = new URL(baseUrl).origin;

    return {
      url: `${origin}/v1/api/openplatform/coding_plan/remains`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
    };
  },

  parseResponse(json, responseStatus) {
    if (responseStatus !== 200) {
      return { rateLimits: null, balance: null, error: { status: responseStatus, reason: 'http' } };
    }

    if (json?.base_resp?.status_code != null && json.base_resp.status_code !== 0) {
      return {
        rateLimits: null,
        balance: null,
        error: {
          reason: 'api-error',
          status: json.base_resp.status_code,
          message: json.base_resp.status_msg,
        },
      };
    }

    const model = (json?.model_remains ?? []).find((item) => item.model_name?.toLowerCase().startsWith('minimax-m'));

    if (!model) {
      return { rateLimits: null, balance: null, error: { reason: 'no-model-found' } };
    }

    const total = model.current_interval_total_count ?? 0;
    const remaining = model.current_interval_usage_count ?? 0;
    const used = total - remaining;
    const fiveHourUtil = total > 0 ? (used / total) * 100 : 0;

    const weeklyTotal = model.current_weekly_total_count ?? 0;
    const weeklyRemaining = model.current_weekly_usage_count ?? 0;
    const weeklyUsed = weeklyTotal - weeklyRemaining;
    const weeklyUtil = weeklyTotal > 0 ? (weeklyUsed / weeklyTotal) * 100 : 0;

    return {
      rateLimits: {
        five_hour: {
          utilization: fiveHourUtil,
          resets_at: model.end_time ? new Date(model.end_time).toISOString() : null,
        },
        seven_day: {
          utilization: weeklyUtil,
          resets_at: model.weekly_end_time ? new Date(model.weekly_end_time).toISOString() : null,
        },
        seven_day_sonnet: null,
        seven_day_opus: null,
        extra_usage: null,
      },
      balance: null,
    };
  },
};

registerProvider(minimaxAdapter);
export default minimaxAdapter;
