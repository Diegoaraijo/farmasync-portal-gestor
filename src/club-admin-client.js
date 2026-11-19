function createClubAdminClient({ baseUrl, token, fetchImpl = fetch }) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/$/, "");

  async function request(path, method, payload) {
    if (!normalizedBaseUrl || String(token || "").length < 24) {
      const error = new Error("club_admin_not_configured");
      error.status = 503;
      throw error;
    }
    const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-club-admin-token": token,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({ error: "service_unavailable" }));
    if (!response.ok) {
      const error = new Error(result.error || "service_unavailable");
      error.status = response.status;
      error.payload = result;
      throw error;
    }
    return result;
  }

  return {
    changePhone(memberId, payload) {
      return request(`/api/admin/members/${memberId}/phone`, "PUT", payload);
    },
    setActive(memberId, payload) {
      return request(`/api/admin/members/${memberId}/status`, "PUT", payload);
    },
    adjustPoints(memberId, payload) {
      return request(`/api/admin/members/${memberId}/points`, "POST", payload);
    },
    setCashbackBlocked(memberId, payload) {
      return request(`/api/admin/members/${memberId}/cashback-block`, "PUT", payload);
    },
    grantManualCashback(memberId, payload) {
      return request(`/api/admin/members/${memberId}/cashback`, "POST", payload);
    },
    cancelCashback(cashbackId, payload) {
      return request(`/api/admin/cashbacks/${cashbackId}/cancel`, "POST", payload);
    },
    changeBirthDate(memberId, payload) {
      return request(`/api/admin/members/${memberId}/birth-date`, "PUT", payload);
    },
  };
}

module.exports = { createClubAdminClient };
