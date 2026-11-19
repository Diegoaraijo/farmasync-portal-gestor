const { MAX_CODE_FAILURES, REQUEST_EXPIRES_MINUTES } = require("./deliveries");

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function tierForSpent(spent, thresholds = {}) {
  const amount = Math.max(0, Math.round((Number(spent) || 0) * 100) / 100);
  const silver = Number(thresholds.silver);
  const gold = Number(thresholds.gold);
  const silverThreshold = Number.isFinite(silver) && silver >= 0 ? silver : 300;
  const goldThreshold = Number.isFinite(gold) && gold > silverThreshold ? gold : Math.max(silverThreshold, 800);
  const level = amount >= goldThreshold ? "OURO" : amount >= silverThreshold ? "PRATA" : "BRONZE";
  const nextLevel = level === "OURO" ? null : level === "PRATA" ? "OURO" : "PRATA";
  const nextThreshold = nextLevel === "OURO" ? goldThreshold : nextLevel === "PRATA" ? silverThreshold : null;
  const amountToNext = nextThreshold === null ? 0 : Math.round(Math.max(0, nextThreshold - amount) * 100) / 100;
  return { level, spent: amount, nextLevel, nextThreshold, amountToNext };
}

function buildClubRiskOverview(rawRows) {  const rows = rawRows.map((row) => ({
    reference: String(row.referencia_externa || ""),
    saleId: Number(/^FARMASYNC-VENDA-(\d+)$/.exec(String(row.referencia_externa || ""))?.[1] || 0) || null,
    memberId: Number(row.membro_id),
    memberName: String(row.membro_nome || "Membro"),
    operatorId: row.operador_id === null ? null : String(row.operador_id),
    paymentMethod: String(row.forma_pagamento || ""),
    saleChannel: String(row.canal_venda || ""),
    saleAmount: row.valor_venda === null ? null : Number(row.valor_venda),
    linkSource: String(row.origem_vinculo || ""),
    points: Number(row.pontos || 0),
    soldAt: row.venda_em || row.criado_em,
    linkedAt: row.vinculado_em || null,
    reversedAt: row.estornado_em || null,
  })).sort((left, right) => new Date(left.soldAt) - new Date(right.soldAt));
  const active = rows.filter((row) => !row.reversedAt);
  const sortedPoints = active.map((row) => row.points).sort((left, right) => left - right);
  const middle = Math.floor(sortedPoints.length / 2);
  const medianPoints = sortedPoints.length % 2
    ? sortedPoints[middle] : ((sortedPoints[middle - 1] || 0) + (sortedPoints[middle] || 0)) / 2;
  const alerts = [];
  const saleEvidence = (evidenceRows) => [...evidenceRows]
    .sort((left, right) => new Date(right.soldAt) - new Date(left.soldAt))
    .slice(0, 12)
    .map((row) => ({
      reference: row.reference || null, saleId: row.saleId, amount: row.saleAmount,
      points: row.points, paymentMethod: row.paymentMethod || null,
      saleChannel: row.saleChannel || null, operatorId: row.operatorId,
      soldAt: row.soldAt, linkedAt: row.linkedAt, reversedAt: row.reversedAt,
    }));
  const addAlert = (type, severity, title, detail, row, count, evidenceRows = [row]) => alerts.push({
    type, severity, title, detail, count, memberId: row?.memberId || null,
    memberName: row?.memberName || null, operatorId: row?.operatorId || null,
    lastEventAt: row?.soldAt || null, relatedSales: saleEvidence(evidenceRows.filter(Boolean)),
  });

  const byMember = groupBy(active, (row) => row.memberId);
  for (const memberRows of byMember.values()) {
    let largestWindow = [];
    for (let start = 0, end = 0; end < memberRows.length; end += 1) {
      while (new Date(memberRows[end].soldAt) - new Date(memberRows[start].soldAt) > 15 * 60_000) start += 1;
      const window = memberRows.slice(start, end + 1);
      if (window.length > largestWindow.length) largestWindow = window;
    }
    if (largestWindow.length >= 3) {
      const latest = largestWindow.at(-1);
      addAlert("RAPID_PURCHASES", "high", "Muitas compras em poucos minutos",
        `${largestWindow.length} compras pontuadas em até 15 minutos.`, latest, largestWindow.length, largestWindow);
    }
    const recentPayments = new Set(memberRows.slice(-6).map((row) => row.paymentMethod).filter(Boolean));
    if (memberRows.length >= 3 && recentPayments.size >= 3) {
      const latest = memberRows.at(-1);
      addAlert("VARIED_PAYMENTS", "medium", "Formas de pagamento muito variadas",
        `${recentPayments.size} formas diferentes nas últimas compras do membro.`, latest, recentPayments.size, memberRows.slice(-6));
    }
  }

  const highThreshold = Math.max(500, medianPoints * 3);
  for (const row of active.filter((item) => item.points >= highThreshold)) {
    addAlert("HIGH_POINTS", "high", "Pontuação muito acima da média",
      `${row.points} pontos em uma venda; mediana recente de ${Math.round(medianPoints)}.`, row, 1);
  }
  for (const row of active) {
    if (row.linkSource !== "CARD" || !row.linkedAt) continue;
    const seconds = (new Date(row.soldAt) - new Date(row.linkedAt)) / 1000;
    if (seconds >= 0 && seconds <= 30) {
      addAlert("LATE_CARD", "low", "Carteirinha incluída no fim da venda",
        `Vínculo feito ${Math.round(seconds)} segundos antes da conclusão.`, row, 1);
    }
  }

  const byOperator = groupBy(active.filter((row) => row.operatorId), (row) => row.operatorId);
  for (const operatorRows of byOperator.values()) {
    const memberGroups = groupBy(operatorRows, (row) => row.memberId);
    for (const memberRows of memberGroups.values()) {
      const share = memberRows.length / operatorRows.length;
      if (memberRows.length >= 3 && share >= 0.5) {
        const latest = memberRows.at(-1);
        addAlert("OPERATOR_CONCENTRATION", "high", "Operador concentrou pontos em um membro",
          `${memberRows.length} de ${operatorRows.length} vendas do operador foram para este membro.`, latest, memberRows.length, memberRows);
      }
    }
    let run = [];
    for (const row of operatorRows) {
      run = run.at(-1)?.memberId === row.memberId ? [...run, row] : [row];
      if (run.length === 3) {
        addAlert("CONSECUTIVE_SALES", "high", "Compras sucessivas no mesmo caixa",
          "O mesmo membro recebeu pontos em 3 vendas seguidas deste operador.", row, run.length, run);
      }
    }
  }

  const severityOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
    || new Date(right.lastEventAt) - new Date(left.lastEventAt));
  return {
    periodDays: 30,
    monitoredSales: rows.length,
    reversedSales: rows.length - active.length,
    alertCount: alerts.length,
    alerts: alerts.slice(0, 30),
  };
}

const PRODUCT_FILTERS = {
  promo: "(preco_promocional > 0 OR (promo_qtd > 0 AND promo_preco_pacote > 0))",
  lowstock: "(estoque > 0 AND estoque_minimo > 0 AND estoque <= estoque_minimo)",
  nostock: "estoque <= 0",
  expiry: "(validade IS NOT NULL AND estoque > 0 AND validade <= DATE_ADD(UTC_DATE(), INTERVAL 60 DAY))",
};

// Regras que o balcão aplicaria de qualquer forma, avisadas na hora ao gestor:
// modelo (filho) segue o produto principal; produto principal de modelos tem
// estoque calculado pela soma dos modelos; promoção exige o FarmaSync atualizado.
function productUpdateConflict(current, product) {
  const same = (left, right) => Math.abs(Number(left || 0) - Number(right || 0)) < 0.005;
  const kind = Number(current.tipo_modelo || 0);
  const promotion = product.promotion;
  if (promotion && !Number(current.detalhes || 0)) return "pc_update_required";
  if (kind === 2) {
    const promoDiffers = promotion && (
      !same(promotion.promoPrice, current.preco_promocional)
      || !same(promotion.promoQty, current.promo_qtd)
      || !same(promotion.promoPackagePrice, current.promo_preco_pacote)
    );
    if (String(product.name) !== String(current.nome) || !same(product.salePrice, current.preco_venda) || promoDiffers) {
      return "model_follows_parent";
    }
  }
  if (kind === 1 && Number(product.stock) !== Number(current.estoque)) return "parent_stock_from_models";
  return null;
}

function createRepository(pool) {
  return {
    async health() {
      await pool.query("SELECT 1");
      await pool.query("SELECT 1 FROM clientes_sistema LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_metricas LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_metricas_diarias LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_campanhas LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_campanhas_resultados LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_estoque_resumo LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_estoque_alertas LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_produtos LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_produto_atualizacoes LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_caixa_resumo LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_entregas_fiado_resumo LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_entregas_fiado_periodos LIMIT 1");
      await pool.query("SELECT 1 FROM clientes_sistema_acoes_suspeitas_periodos LIMIT 1");
      await pool.query("SELECT 1 FROM portal_gestor_users LIMIT 1");
      await pool.query("SELECT 1 FROM portal_gestor_sessions LIMIT 1");
      await pool.query("SELECT 1 FROM portal_gestor_password_resets LIMIT 1");
    },

    async userByEmail(email) {
      const [rows] = await pool.execute(
        `SELECT u.id, u.cliente_id, u.name, u.email, u.password_salt, u.password_hash,
          u.password_change_required
           FROM portal_gestor_users u
           JOIN clientes_sistema c ON c.id = u.cliente_id
          WHERE u.email = ? AND u.active = 1 AND c.status = 'Ativo'
          LIMIT 1`,
        [email],
      );
      return rows[0] || null;
    },

    async createSession(userId, tokenHash, expiresAt, remember = false) {
      await pool.execute(
        "INSERT INTO portal_gestor_sessions (user_id, token_hash, expires_at, remember) VALUES (?, ?, ?, ?)",
        [userId, tokenHash, expiresAt, remember ? 1 : 0],
      );
    },

    async sessionByTokenHash(tokenHash) {
      const [rows] = await pool.execute(
        `SELECT s.user_id, u.cliente_id, u.name, u.email,
          u.password_change_required, s.remember,
          TIMESTAMPDIFF(SECOND, s.created_at, CURRENT_TIMESTAMP) AS age_seconds,
          TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), s.expires_at) AS seconds_left
           FROM portal_gestor_sessions s
           JOIN portal_gestor_users u ON u.id = s.user_id AND u.active = 1
           JOIN clientes_sistema c ON c.id = u.cliente_id AND c.status = 'Ativo'
          WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
            AND (s.remember = 0 OR s.created_at > CURRENT_TIMESTAMP - INTERVAL 90 DAY)
          LIMIT 1`,
        [tokenHash],
      );
      return rows[0] || null;
    },

    async renewSession(tokenHash, expiresAt) {
      await pool.execute(
        "UPDATE portal_gestor_sessions SET expires_at = ? WHERE token_hash = ? AND remember = 1",
        [expiresAt, tokenHash],
      );
    },

    async deleteSession(tokenHash) {
      await pool.execute("DELETE FROM portal_gestor_sessions WHERE token_hash = ?", [tokenHash]);
    },

    async updatePassword(userId, passwordSalt, passwordHash) {
      await pool.execute(
        `UPDATE portal_gestor_users
            SET password_salt = ?, password_hash = ?, password_change_required = 0
          WHERE id = ? AND active = 1`,
        [passwordSalt, passwordHash, userId],
      );
    },

    async createPasswordReset(userId, tokenHash, expiresAt) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          "DELETE FROM portal_gestor_password_resets WHERE user_id = ? OR expires_at <= UTC_TIMESTAMP()",
          [userId],
        );
        await connection.execute(
          "INSERT INTO portal_gestor_password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
          [userId, tokenHash, expiresAt],
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async resetPasswordByTokenHash(tokenHash, passwordSalt, passwordHash) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          `SELECT r.id, r.user_id
             FROM portal_gestor_password_resets r
             JOIN portal_gestor_users u ON u.id = r.user_id AND u.active = 1
            WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > UTC_TIMESTAMP()
            LIMIT 1 FOR UPDATE`,
          [tokenHash],
        );
        if (!rows[0]) {
          await connection.rollback();
          return false;
        }
        await connection.execute(
          `UPDATE portal_gestor_users
              SET password_salt = ?, password_hash = ?, password_change_required = 0
            WHERE id = ?`,
          [passwordSalt, passwordHash, rows[0].user_id],
        );
        await connection.execute(
          "UPDATE portal_gestor_password_resets SET used_at = UTC_TIMESTAMP() WHERE id = ?",
          [rows[0].id],
        );
        await connection.execute(
          "DELETE FROM portal_gestor_sessions WHERE user_id = ?",
          [rows[0].user_id],
        );
        await connection.commit();
        return true;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async dashboardByClientId(clientId) {
      const [rows] = await pool.execute(
        `SELECT c.nome, c.status, m.*
           FROM clientes_sistema c
           LEFT JOIN clientes_sistema_metricas m ON m.chave_licenca = c.chave_licenca
          WHERE c.id = ?
          LIMIT 1`,
        [clientId],
      );
      return rows[0] || null;
    },

    async syncHealthByClientId(clientId) {
      const [rows] = await pool.execute(
        `SELECT m.snapshot_em
           FROM clientes_sistema c
           LEFT JOIN clientes_sistema_metricas m ON m.chave_licenca = c.chave_licenca
          WHERE c.id = ?
          LIMIT 1`,
        [clientId],
      );
      return rows[0] || null;
    },

    async salesHistoryByClientId(clientId, startDate, endDate) {
      const [rows] = await pool.execute(
        `SELECT DATE_FORMAT(data_referencia, '%Y-%m-%d') AS data_referencia,
          qtd_vendas, valor_vendas,
                qtd_trocas, valor_trocas,
                qtd_devolucoes, valor_devolucoes,
                qtd_cancelamentos, valor_cancelamentos
           FROM clientes_sistema_metricas_diarias
          WHERE cliente_id = ?
            AND data_referencia BETWEEN ? AND ?
          ORDER BY data_referencia`,
        [clientId, startDate, endDate],
      );
      return rows || [];
    },

    async campaignsByClientId(clientId) {
      const [rows] = await pool.execute(
        `SELECT campanha_origem_id, nome, ativa, modo,
                DATE_FORMAT(data_inicio, '%Y-%m-%d') AS data_inicio,
                DATE_FORMAT(data_fim, '%Y-%m-%d') AS data_fim,
                premios_json, participacoes, ganhadores, retirados, pendentes
           FROM clientes_sistema_campanhas
          WHERE cliente_id = ?
          ORDER BY ativa DESC, data_fim DESC, campanha_origem_id DESC`,
        [clientId],
      );
      return rows || [];
    },

    async campaignWinnersByClientId(clientId, limit = 20) {
      const safeLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 20)));
      const [rows] = await pool.execute(
        `SELECT campanha_nome, premio_nome, codigo_final,
                DATE_FORMAT(data_hora, '%Y-%m-%d %H:%i:%s') AS data_hora,
                retirado,
                DATE_FORMAT(retirado_em, '%Y-%m-%d %H:%i:%s') AS retirado_em
           FROM clientes_sistema_campanhas_resultados
          WHERE cliente_id = ?
          ORDER BY data_hora DESC, id DESC
          LIMIT ${safeLimit}`,
        [clientId],
      );
      return rows || [];
    },

    async clubOverviewByClientId(clientId) {
      const [storeRows] = await pool.execute(
        `SELECT id, slug, nome_publico, cor_principal, ativa, validade_pontos_meses,
                tier_prata_gasto, tier_ouro_gasto, indicacao_pontos_bonus, cashback_pontos_por_real,
                aniversario_ativo, aniversario_pontos, aniversario_antecedencia_dias
           FROM clube_lojas
          WHERE cliente_id = ?
          LIMIT 1`,
        [clientId],
      );
      const store = storeRows[0];
      if (!store) return null;

      const [[memberMetrics], [pointMetrics], [couponMetrics], [memberRows], [couponRows], [auditRows], [cashbackMetrics], [cashbackRows], [referralRows]] = await Promise.all([
        pool.execute(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN ativo = 1 THEN 1 ELSE 0 END) AS ativos,
                  SUM(CASE WHEN ativo = 1 AND consentimento_marketing_em IS NOT NULL THEN 1 ELSE 0 END) AS marketing,
                  SUM(CASE WHEN ativo = 1 AND indicado_por_membro_id IS NOT NULL THEN 1 ELSE 0 END) AS indicados
             FROM clube_membros
            WHERE loja_id = ?`,
          [store.id],
        ),
        pool.execute(
          `SELECT COALESCE(SUM(saldo), 0) AS saldo,
               COALESCE(SUM(vencendo_30_dias), 0) AS vencendo_30_dias,
               DATE_FORMAT(MIN(proxima_expiracao), '%Y-%m-%d') AS proxima_expiracao
             FROM (
            SELECT m.id, COALESCE(s.saldo, 0)
                  + COALESCE(SUM(CASE WHEN l.expira_em IS NULL OR l.expira_em > UTC_TIMESTAMP() THEN l.pontos_disponiveis ELSE 0 END), 0) AS saldo,
                COALESCE(SUM(CASE WHEN l.expira_em > UTC_TIMESTAMP() AND l.expira_em <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY) THEN l.pontos_disponiveis ELSE 0 END), 0) AS vencendo_30_dias,
                MIN(CASE WHEN l.pontos_disponiveis > 0 AND l.expira_em > UTC_TIMESTAMP() THEN l.expira_em END) AS proxima_expiracao
              FROM clube_membros m
              LEFT JOIN clube_pontos_saldos_legado s ON s.membro_id = m.id AND s.loja_id = m.loja_id
              LEFT JOIN clube_pontos_lotes l ON l.membro_id = m.id AND l.loja_id = m.loja_id
             WHERE m.loja_id = ? AND m.ativo = 1
             GROUP BY m.id, s.saldo
             ) saldos_membros`,
          [store.id],
        ),
        pool.execute(
          `SELECT COUNT(DISTINCT CASE WHEN c.ativo = 1 AND c.expira_em > NOW() THEN c.id END) AS ativos,
                  COUNT(mc.id) AS ativados,
                  SUM(CASE WHEN mc.resgatado_em IS NOT NULL THEN 1 ELSE 0 END) AS resgatados
             FROM clube_cupons c
             LEFT JOIN clube_membros_cupons mc ON mc.cupom_id = c.id AND mc.loja_id = c.loja_id
            WHERE c.loja_id = ?`,
          [store.id],
        ),
        pool.execute(
            `SELECT m.id, m.nome, m.telefone_final, m.ativo, m.cashback_bloqueado,
              DATE_FORMAT(m.data_nascimento, '%Y-%m-%d') AS data_nascimento,
                  DATE_FORMAT(m.criado_em, '%Y-%m-%d %H:%i:%s') AS criado_em,
                     COALESCE(s.saldo, 0) + COALESCE(SUM(CASE WHEN p.expira_em IS NULL OR p.expira_em > UTC_TIMESTAMP() THEN p.pontos_disponiveis ELSE 0 END), 0) AS saldo,
                  (SELECT COALESCE(SUM(a.valor_venda), 0) FROM clube_vendas_auditoria a
                    WHERE a.membro_id = m.id AND a.loja_id = m.loja_id AND a.estornado_em IS NULL
                      AND a.criado_em >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 MONTH)) AS gasto_12m
             FROM clube_membros m
                   LEFT JOIN clube_pontos_saldos_legado s ON s.membro_id = m.id AND s.loja_id = m.loja_id
                   LEFT JOIN clube_pontos_lotes p ON p.membro_id = m.id AND p.loja_id = m.loja_id
            WHERE m.loja_id = ? AND m.mesclado_em_membro_id IS NULL
                  GROUP BY m.id, m.nome, m.telefone_final, m.ativo, m.data_nascimento, m.criado_em, s.saldo
            ORDER BY saldo DESC, m.ativo DESC, m.nome, m.id DESC`,
          [store.id],
        ),
        pool.execute(
            `SELECT c.id, c.titulo, c.descricao, c.codigo, c.pontos_custo, c.ativo,
              CASE WHEN c.expira_em <= NOW() THEN 1 ELSE 0 END AS expirado,
                  DATE_FORMAT(c.expira_em, '%Y-%m-%d %H:%i:%s') AS expira_em,
                  COUNT(mc.id) AS ativados,
                  SUM(CASE WHEN mc.resgatado_em IS NOT NULL THEN 1 ELSE 0 END) AS resgatados
             FROM clube_cupons c
             LEFT JOIN clube_membros_cupons mc ON mc.cupom_id = c.id AND mc.loja_id = c.loja_id
            WHERE c.loja_id = ?
            GROUP BY c.id, c.titulo, c.descricao, c.codigo, c.pontos_custo, c.ativo, c.expira_em
            ORDER BY c.ativo DESC, c.expira_em DESC, c.id DESC`,
          [store.id],
        ),
        pool.execute(
            `SELECT a.referencia_externa, a.membro_id, m.nome AS membro_nome, a.operador_id,
              a.valor_venda, a.forma_pagamento, a.canal_venda, a.origem_vinculo, e.pontos,
                  DATE_FORMAT(a.venda_em, '%Y-%m-%d %H:%i:%s') AS venda_em,
                  DATE_FORMAT(a.vinculado_em, '%Y-%m-%d %H:%i:%s') AS vinculado_em,
                  DATE_FORMAT(a.estornado_em, '%Y-%m-%d %H:%i:%s') AS estornado_em,
                  DATE_FORMAT(a.criado_em, '%Y-%m-%d %H:%i:%s') AS criado_em
             FROM clube_vendas_auditoria a
             JOIN clube_membros m ON m.id = a.membro_id AND m.loja_id = a.loja_id
             JOIN clube_pontos_extrato e ON e.id = a.extrato_id AND e.loja_id = a.loja_id
            WHERE a.loja_id = ? AND a.criado_em >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
            ORDER BY a.criado_em, a.id
            LIMIT 5000`,
          [store.id],
        ),
        pool.execute(
          `SELECT COUNT(*) AS gerados, COALESCE(SUM(valor_reais), 0) AS valor_gerado,
                  SUM(CASE WHEN resgatado_em IS NULL AND cancelado_em IS NULL THEN 1 ELSE 0 END) AS abertos,
                  COALESCE(SUM(CASE WHEN resgatado_em IS NULL AND cancelado_em IS NULL THEN valor_reais ELSE 0 END), 0) AS valor_aberto,
                  SUM(CASE WHEN resgatado_em IS NOT NULL THEN 1 ELSE 0 END) AS resgatados,
                  COALESCE(SUM(CASE WHEN resgatado_em IS NOT NULL THEN valor_reais ELSE 0 END), 0) AS valor_resgatado,
                  SUM(CASE WHEN cancelado_em IS NOT NULL THEN 1 ELSE 0 END) AS cancelados,
                  COALESCE(SUM(CASE WHEN cancelado_em IS NOT NULL THEN valor_reais ELSE 0 END), 0) AS valor_cancelado
             FROM clube_cashback_conversoes
            WHERE loja_id = ?`,
          [store.id],
        ),
        pool.execute(
          `SELECT c.id, c.membro_id, m.nome AS membro_nome, c.valor_reais, c.origem,
                  c.resgatado_em, c.cancelado_em, c.reserva_expira_em,
                  DATE_FORMAT(c.criado_em, '%Y-%m-%d %H:%i:%s') AS criado_em,
                  c.reserva_expira_em > UTC_TIMESTAMP() AS reservado
             FROM clube_cashback_conversoes c
             JOIN clube_membros m ON m.id = c.membro_id AND m.loja_id = c.loja_id
            WHERE c.loja_id = ?
            ORDER BY c.criado_em DESC, c.id DESC LIMIT 100`,
          [store.id],
        ),
        pool.execute(
          `SELECT indicado.id AS indicado_id, indicado.nome AS indicado_nome,
                  indicado.telefone_final AS indicado_telefone_final,
                  indicador.id AS indicador_id, indicador.nome AS indicador_nome,
                  indicador.telefone_final AS indicador_telefone_final,
                  indicado.bonus_indicacao_creditado,
                  DATE_FORMAT(indicado.criado_em, '%Y-%m-%d %H:%i:%s') AS indicado_em,
                  MAX(extrato.pontos) AS bonus_pontos,
                  DATE_FORMAT(MAX(extrato.criado_em), '%Y-%m-%d %H:%i:%s') AS bonus_creditado_em
             FROM clube_membros indicado
             JOIN clube_membros indicador
               ON indicador.id = indicado.indicado_por_membro_id
              AND indicador.loja_id = indicado.loja_id
             LEFT JOIN clube_pontos_extrato extrato
               ON extrato.loja_id = indicado.loja_id
              AND extrato.membro_id = indicado.id
              AND extrato.tipo = 'INDICACAO_INDICADO'
            WHERE indicado.loja_id = ? AND indicado.mesclado_em_membro_id IS NULL
            GROUP BY indicado.id, indicado.nome, indicado.telefone_final,
                     indicador.id, indicador.nome, indicador.telefone_final,
                     indicado.bonus_indicacao_creditado, indicado.criado_em
            ORDER BY indicado.criado_em DESC, indicado.id DESC
            LIMIT 100`,
          [store.id],
        ),
      ]);

      const tierThresholds = {
        silver: Number(store.tier_prata_gasto || 300),
        gold: Number(store.tier_ouro_gasto || 800),
      };
      const membersWithTier = memberRows.map((member) => ({
        id: Number(member.id),
        name: member.nome,
        phoneSuffix: member.telefone_final,
        joinedAt: member.criado_em,
        balance: Number(member.saldo || 0),
        active: Boolean(Number(member.ativo)),
        cashbackBlocked: Boolean(Number(member.cashback_bloqueado)),
        birthDate: member.data_nascimento || null,
        tier: tierForSpent(member.gasto_12m, tierThresholds).level,
      }));
      const tierDistribution = { BRONZE: 0, PRATA: 0, OURO: 0 };
      for (const member of membersWithTier) {
        if (member.active) tierDistribution[member.tier] += 1;
      }

      return {
        store: {
          slug: store.slug,
          name: store.nome_publico,
          color: store.cor_principal,
          active: Boolean(Number(store.ativa)),
          pointsValidityMonths: store.validade_pontos_meses === null ? null : Number(store.validade_pontos_meses),
          tierThresholds,
          referralBonusPoints: Number(store.indicacao_pontos_bonus || 0),
          cashbackPointsPerReal: Number(store.cashback_pontos_por_real || 100),
          birthdayEnabled: Boolean(Number(store.aniversario_ativo)),
          birthdayPoints: Number(store.aniversario_pontos || 150),
          birthdayLeadDays: Number(store.aniversario_antecedencia_dias || 30),
        },
        metrics: {
          members: Number(memberMetrics[0]?.total || 0),
          activeMembers: Number(memberMetrics[0]?.ativos || 0),
          marketingMembers: Number(memberMetrics[0]?.marketing || 0),
          referredMembers: Number(memberMetrics[0]?.indicados || 0),
          pointsBalance: Number(pointMetrics[0]?.saldo || 0),
          pointsExpiring30Days: Number(pointMetrics[0]?.vencendo_30_dias || 0),
          nextPointsExpiration: pointMetrics[0]?.proxima_expiracao || null,
          activeCoupons: Number(couponMetrics[0]?.ativos || 0),
          activatedCoupons: Number(couponMetrics[0]?.ativados || 0),
          redeemedCoupons: Number(couponMetrics[0]?.resgatados || 0),
          tierDistribution,
          cashback: {
            issuedCount: Number(cashbackMetrics[0]?.gerados || 0),
            issuedAmount: Number(cashbackMetrics[0]?.valor_gerado || 0),
            openCount: Number(cashbackMetrics[0]?.abertos || 0),
            openAmount: Number(cashbackMetrics[0]?.valor_aberto || 0),
            redeemedCount: Number(cashbackMetrics[0]?.resgatados || 0),
            redeemedAmount: Number(cashbackMetrics[0]?.valor_resgatado || 0),
            canceledCount: Number(cashbackMetrics[0]?.cancelados || 0),
            canceledAmount: Number(cashbackMetrics[0]?.valor_cancelado || 0),
          },
        },
        recentMembers: membersWithTier,
        coupons: couponRows.map((coupon) => ({
          id: Number(coupon.id),
          title: coupon.titulo,
          description: coupon.descricao,
          code: coupon.codigo,
          pointsCost: Number(coupon.pontos_custo || 0),
          expiresAt: coupon.expira_em,
          active: Boolean(Number(coupon.ativo)),
          expired: Boolean(Number(coupon.expirado)),
          activations: Number(coupon.ativados || 0),
          redemptions: Number(coupon.resgatados || 0),
        })),
        cashbacks: cashbackRows.map((cashback) => ({
          id: Number(cashback.id), memberId: Number(cashback.membro_id), memberName: cashback.membro_nome,
          amount: Number(cashback.valor_reais || 0), origin: cashback.origem,
          createdAt: cashback.criado_em, state: cashback.cancelado_em ? "CANCELADO"
            : cashback.resgatado_em ? "USADO" : Boolean(Number(cashback.reservado)) ? "RESERVADO" : "PENDENTE",
        })),
        referrals: referralRows.map((referral) => ({
          referredMemberId: Number(referral.indicado_id),
          referredName: referral.indicado_nome,
          referredPhoneSuffix: referral.indicado_telefone_final,
          referrerMemberId: Number(referral.indicador_id),
          referrerName: referral.indicador_nome,
          referrerPhoneSuffix: referral.indicador_telefone_final,
          referredAt: referral.indicado_em,
          firstPurchaseCompleted: Boolean(Number(referral.bonus_indicacao_creditado)),
          bonusPointsEach: referral.bonus_pontos === null ? null : Number(referral.bonus_pontos),
          bonusCreditedAt: referral.bonus_creditado_em || null,
        })),
        riskMonitoring: buildClubRiskOverview(auditRows),
      };
    },

    async updateClubPointsValidity(clientId, months) {
      const [result] = await pool.execute(
        `UPDATE clube_lojas SET validade_pontos_meses = ?
          WHERE cliente_id = ?`,
        [months, clientId],
      );
      return result.affectedRows > 0;
    },

    async updateClubTiers(clientId, silverAmount, goldAmount) {
      const [result] = await pool.execute(
        `UPDATE clube_lojas SET tier_prata_gasto = ?, tier_ouro_gasto = ?
          WHERE cliente_id = ?`,
        [silverAmount, goldAmount, clientId],
      );
      return result.affectedRows > 0;
    },

    async updateClubReferralBonus(clientId, points) {
      const [result] = await pool.execute(
        `UPDATE clube_lojas SET indicacao_pontos_bonus = ?
          WHERE cliente_id = ?`,
        [points, clientId],
      );
      return result.affectedRows > 0;
    },

    async updateClubCashbackRate(clientId, pointsPerReal) {
      const [result] = await pool.execute(
        `UPDATE clube_lojas SET cashback_pontos_por_real = ?
          WHERE cliente_id = ?`,
        [pointsPerReal, clientId],
      );
      return result.affectedRows > 0;
    },

    async updateClubBirthdayCampaign(clientId, enabled, points, leadDays) {
      const [result] = await pool.execute(
        `UPDATE clube_lojas
            SET aniversario_ativo = ?, aniversario_pontos = ?, aniversario_antecedencia_dias = ?
          WHERE cliente_id = ?`,
        [enabled ? 1 : 0, points, leadDays, clientId],
      );
      return result.affectedRows > 0;
    },

    async createClubCoupon(clientId, coupon) {
      const [result] = await pool.execute(
        `INSERT INTO clube_cupons
          (loja_id, titulo, descricao, codigo, pontos_custo, expira_em, ativo)
         SELECT id, ?, ?, ?, ?, ?, ?
           FROM clube_lojas
          WHERE cliente_id = ?
          LIMIT 1`,
        [coupon.title, coupon.description, coupon.code, coupon.pointsCost,
          coupon.expiresAt, coupon.active ? 1 : 0, clientId],
      );
      return result.affectedRows ? { id: result.insertId } : null;
    },

    async updateClubCoupon(clientId, couponId, coupon) {
      const [result] = await pool.execute(
        `UPDATE clube_cupons c
           JOIN clube_lojas l ON l.id = c.loja_id
            SET c.titulo = ?, c.descricao = ?, c.codigo = ?, c.pontos_custo = ?,
                c.expira_em = ?, c.ativo = ?
          WHERE c.id = ? AND l.cliente_id = ?`,
        [coupon.title, coupon.description, coupon.code, coupon.pointsCost,
          coupon.expiresAt, coupon.active ? 1 : 0, couponId, clientId],
      );
      return result.affectedRows > 0;
    },

    async inventorySummaryByClientId(clientId) {
      const [rows] = await pool.execute(
        `SELECT produtos_ativos, unidades_estoque, valor_estoque_custo, sem_estoque,
                estoque_baixo, vencidos, vencendo_60_dias, sem_validade
           FROM clientes_sistema_estoque_resumo
          WHERE cliente_id = ?
          LIMIT 1`,
        [clientId],
      );
      return rows[0] || null;
    },

    async inventoryAlertsByClientId(clientId, limit = 100) {
      const safeLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 100)));
      const [rows] = await pool.execute(
        `SELECT produto_origem_id, codigo, nome, categoria,
                estoque_atual, estoque_minimo,
                DATE_FORMAT(validade, '%Y-%m-%d') AS validade,
                sem_estoque, estoque_baixo, vencido, sem_validade, dias_para_vencer
           FROM clientes_sistema_estoque_alertas
          WHERE cliente_id = ?
          ORDER BY vencido DESC, sem_estoque DESC,
                   CASE WHEN dias_para_vencer IS NULL THEN 999999 ELSE dias_para_vencer END,
                   estoque_baixo DESC, nome
          LIMIT ${safeLimit}`,
        [clientId],
      );
      return rows || [];
    },

    async productsByClientId(clientId, { search = "", filter = "all", limit = 200 } = {}) {
      const safeLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 200)));
      const term = String(search || "").trim();
      const filters = ["cliente_id = ?", "ativo = 1"];
      const params = [clientId];
      if (term) {
        filters.push("(nome LIKE ? OR codigo LIKE ?)");
        params.push(`%${term}%`, `%${term}%`);
      }
      if (PRODUCT_FILTERS[filter]) filters.push(PRODUCT_FILTERS[filter]);
      const where = filters.join(" AND ");

      const [products] = await pool.execute(
        `SELECT produto_origem_id, codigo, nome, preco_venda, estoque, ativo, snapshot_em,
                categoria, preco_promocional, promo_qtd, promo_preco_pacote,
                DATE_FORMAT(validade, '%Y-%m-%d') AS validade,
                estoque_minimo, tipo_modelo, detalhes, fator_conversao_padrao, unidade_compra
           FROM clientes_sistema_produtos
          WHERE ${where}
          ORDER BY nome, produto_origem_id
          LIMIT ${safeLimit}`,
        params,
      );
      const [[found]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM clientes_sistema_produtos WHERE ${where}`,
        params,
      );
      const [[counts]] = await pool.execute(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ${PRODUCT_FILTERS.promo} THEN 1 ELSE 0 END) AS promo,
                SUM(CASE WHEN ${PRODUCT_FILTERS.lowstock} THEN 1 ELSE 0 END) AS lowstock,
                SUM(CASE WHEN ${PRODUCT_FILTERS.nostock} THEN 1 ELSE 0 END) AS nostock,
                SUM(CASE WHEN ${PRODUCT_FILTERS.expiry} THEN 1 ELSE 0 END) AS expiry
           FROM clientes_sistema_produtos
          WHERE cliente_id = ? AND ativo = 1`,
        [clientId],
      );
      const summary = {
        total: Number(found?.total || 0),
        counts: {
          all: Number(counts?.total || 0),
          promo: Number(counts?.promo || 0),
          lowstock: Number(counts?.lowstock || 0),
          nostock: Number(counts?.nostock || 0),
          expiry: Number(counts?.expiry || 0),
        },
      };
      if (!products || products.length === 0) return { products: [], ...summary };

      // Consultas simples e compatíveis com MySQL, MariaDB e TiDB (sem subconsulta
      // correlacionada no JOIN): a última alteração de cada produto é ligada aqui.
      const [updates] = await pool.execute(
        `SELECT produto_origem_id, status, solicitado_em, nome, preco_venda, estoque, erro,
                preco_promocional, promo_qtd, promo_preco_pacote, promo_alterada
           FROM clientes_sistema_produto_atualizacoes
          WHERE cliente_id = ?
            AND id IN (
              SELECT MAX(id) FROM clientes_sistema_produto_atualizacoes
               WHERE cliente_id = ? GROUP BY produto_origem_id
            )`,
        [clientId, clientId],
      );
      const latest = new Map((updates || []).map((item) => [Number(item.produto_origem_id), item]));
      return {
        products: products.map((product) => {
          const update = latest.get(Number(product.produto_origem_id));
          return {
            ...product,
            atualizacao_status: update?.status ?? null,
            atualizacao_solicitada_em: update?.solicitado_em ?? null,
            atualizacao_nome: update?.nome ?? null,
            atualizacao_preco_venda: update?.preco_venda ?? null,
            atualizacao_estoque: update?.estoque ?? null,
            atualizacao_erro: update?.erro ?? null,
            atualizacao_preco_promocional: update?.preco_promocional ?? null,
            atualizacao_promo_qtd: update?.promo_qtd ?? null,
            atualizacao_promo_preco_pacote: update?.promo_preco_pacote ?? null,
            atualizacao_promo_alterada: update?.promo_alterada ?? 0,
          };
        }),
        ...summary,
      };
    },

    async enqueueProductUpdate(clientId, userId, productId, product) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          `SELECT chave_licenca, produto_origem_id, nome, preco_venda, estoque,
                  preco_promocional, promo_qtd, promo_preco_pacote, tipo_modelo, detalhes
             FROM clientes_sistema_produtos
            WHERE cliente_id = ? AND produto_origem_id = ? AND ativo = 1
            LIMIT 1 FOR UPDATE`,
          [clientId, productId],
        );
        const current = rows[0];
        if (!current) {
          await connection.rollback();
          return null;
        }
        const conflict = productUpdateConflict(current, product);
        if (conflict) {
          await connection.rollback();
          return { conflict };
        }
        const promotion = product.promotion;
        const [result] = await connection.execute(
          `INSERT INTO clientes_sistema_produto_atualizacoes
            (cliente_id, chave_licenca, produto_origem_id, nome,
             preco_venda, estoque, preco_promocional, promo_qtd, promo_preco_pacote,
             promo_alterada, status, solicitado_por_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', ?)`,
          [
            clientId,
            current.chave_licenca,
            current.produto_origem_id,
            product.name,
            product.salePrice,
            product.stock,
            promotion ? promotion.promoPrice : null,
            promotion ? promotion.promoQty : null,
            promotion ? promotion.promoPackagePrice : null,
            promotion ? 1 : 0,
            userId,
          ],
        );
        await connection.commit();
        return {
          updateId: Number(result.insertId),
          productId: Number(current.produto_origem_id),
          status: "PENDENTE",
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async matchCatalogProducts(clientId, sources) {
      const SELECT = `SELECT produto_origem_id, codigo, nome, categoria, preco_venda, preco_promocional,
                             estoque, tipo_modelo, fator_conversao_padrao, unidade_compra
                        FROM clientes_sistema_produtos
                       WHERE cliente_id = ? AND ativo = 1`;
      const normalize = (code) => {
        const compact = String(code ?? "").replace(/\s+/g, "");
        return /^\d+$/.test(compact) ? (compact.replace(/^0+/, "") || "0") : compact.toUpperCase();
      };
      const exact = [...new Set(sources.flatMap((source) => source.codeCandidates))].slice(0, 2000);
      const numeric = [...new Set(exact.map(normalize).filter((code) => /^\d+$/.test(code)))];
      const rows = new Map();
      const collect = (list) => list.forEach((row) => { if (!rows.has(row.produto_origem_id)) rows.set(row.produto_origem_id, row); });
      for (let start = 0; start < exact.length; start += 400) {
        const chunk = exact.slice(start, start + 400);
        const [found] = await pool.execute(
          `${SELECT} AND codigo IN (${chunk.map(() => "?").join(",")}) ORDER BY produto_origem_id`,
          [clientId, ...chunk],
        );
        collect(found || []);
      }
      for (let start = 0; start < numeric.length; start += 400) {
        const chunk = numeric.slice(start, start + 400);
        const [found] = await pool.execute(
          `${SELECT} AND TRIM(LEADING '0' FROM codigo) IN (${chunk.map(() => "?").join(",")}) ORDER BY produto_origem_id`,
          [clientId, ...chunk],
        );
        collect(found || []);
      }
      const catalog = [...rows.values()];
      // Mesma ordem do balcão: primeiro o código exato, depois o código sem zeros à esquerda.
      return sources.map((source) => {
        for (const code of source.codeCandidates) {
          const hit = catalog.find((row) => String(row.codigo) === code);
          if (hit) return hit;
        }
        for (const code of source.codeCandidates) {
          const wanted = normalize(code);
          const hit = catalog.find((row) => normalize(row.codigo) === wanted);
          if (hit) return hit;
        }
        return null;
      });
    },

    async enqueuePurchaseNote(clientId, userId, note) {
      const [clients] = await pool.execute(
        "SELECT chave_licenca FROM clientes_sistema WHERE id = ? LIMIT 1",
        [clientId],
      );
      if (!clients[0]?.chave_licenca) return null;
      const extras = {
        supplier: note.supplier,
        totals: note.totals,
        installments: note.installments,
        options: note.options,
      };
      try {
        const [result] = await pool.execute(
          `INSERT INTO clientes_sistema_notas_entrada
            (cliente_id, chave_licenca, origem, chave_nfe, chave_ativa, chave_dedupe,
             numero_nf, serie, emissao, fornecedor_nome, fornecedor_documento, valor_nf,
             total_itens, itens_json, extras_json, xml_conteudo, observacoes,
             status, solicitado_por_user_id, solicitado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', ?, UTC_TIMESTAMP())`,
          [
            clientId,
            clients[0].chave_licenca,
            note.origin,
            note.accessKey,
            note.dedupeKey,
            note.dedupeKey,
            note.number,
            note.series,
            note.issueDate,
            note.supplier.name,
            note.supplier.document,
            note.totals.invoice,
            note.items.length,
            JSON.stringify(note.items),
            JSON.stringify(extras),
            note.xml,
            note.notes,
            userId,
          ],
        );
        return { id: Number(result.insertId), status: "PENDENTE" };
      } catch (error) {
        if (error?.code !== "ER_DUP_ENTRY") throw error;
        const [existing] = await pool.execute(
          `SELECT id, status FROM clientes_sistema_notas_entrada
            WHERE cliente_id = ? AND chave_ativa = ? LIMIT 1`,
          [clientId, note.dedupeKey],
        );
        return { duplicate: true, existingId: Number(existing[0]?.id || 0) || null, existingStatus: existing[0]?.status || null };
      }
    },

    async activePurchaseNote(clientId, dedupeKey) {
      if (!dedupeKey) return null;
      const [rows] = await pool.execute(
        `SELECT id, status FROM clientes_sistema_notas_entrada
          WHERE cliente_id = ? AND chave_ativa = ? LIMIT 1`,
        [clientId, dedupeKey],
      );
      return rows[0] || null;
    },

    async purchaseNotesByClientId(clientId, limit = 30) {
      const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 30)));
      const [rows] = await pool.execute(
        `SELECT id, origem, chave_nfe, numero_nf, serie,
                DATE_FORMAT(emissao, '%Y-%m-%d') AS emissao,
                fornecedor_nome, fornecedor_documento, valor_nf, total_itens, status,
                itens_atualizados, itens_criados, itens_ignorados, erro, extras_json,
                DATE_FORMAT(solicitado_em, '%Y-%m-%dT%H:%i:%sZ') AS solicitado_em,
                DATE_FORMAT(aplicado_em, '%Y-%m-%dT%H:%i:%sZ') AS aplicado_em
           FROM clientes_sistema_notas_entrada
          WHERE cliente_id = ?
          ORDER BY id DESC
          LIMIT ${safeLimit}`,
        [clientId],
      );
      return rows || [];
    },

    async purchaseNoteById(clientId, noteId) {
      const [rows] = await pool.execute(
        `SELECT id, origem, chave_nfe, numero_nf, serie,
                DATE_FORMAT(emissao, '%Y-%m-%d') AS emissao,
                fornecedor_nome, fornecedor_documento, valor_nf, total_itens, status,
                itens_atualizados, itens_criados, itens_ignorados, erro, extras_json,
                itens_json, resultado_json, observacoes,
                DATE_FORMAT(solicitado_em, '%Y-%m-%dT%H:%i:%sZ') AS solicitado_em,
                DATE_FORMAT(aplicado_em, '%Y-%m-%dT%H:%i:%sZ') AS aplicado_em
           FROM clientes_sistema_notas_entrada
          WHERE cliente_id = ? AND id = ?
          LIMIT 1`,
        [clientId, noteId],
      );
      return rows[0] || null;
    },

    // Só dá para cancelar enquanto o balcão ainda não começou a lançar a nota.
    async cancelPurchaseNote(clientId, noteId) {
      const [result] = await pool.execute(
        `UPDATE clientes_sistema_notas_entrada
            SET status = 'CANCELADO', chave_ativa = NULL
          WHERE cliente_id = ? AND id = ? AND status = 'PENDENTE'`,
        [clientId, noteId],
      );
      return Number(result.affectedRows || 0) === 1;
    },

    async retryPurchaseNote(clientId, noteId) {
      try {
        const [result] = await pool.execute(
          `UPDATE clientes_sistema_notas_entrada
              SET status = 'PENDENTE', chave_ativa = chave_dedupe, erro = NULL,
                  processando_em = NULL, resultado_json = NULL,
                  itens_atualizados = 0, itens_criados = 0, itens_ignorados = 0
            WHERE cliente_id = ? AND id = ? AND status = 'FALHOU'`,
          [clientId, noteId],
        );
        return { retried: Number(result.affectedRows || 0) === 1 };
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") return { duplicate: true };
        throw error;
      }
    },

    async pendingDeliveriesByClientId(clientId) {
      const [rows] = await pool.execute(
        `SELECT venda_id, hora_venda, espera_minutos, valor, cliente_nome, entregador_nome,
                pagamento, origem, pedido_app_numero,
                DATE_FORMAT(snapshot_em, '%Y-%m-%dT%H:%i:%sZ') AS snapshot_em
           FROM clientes_sistema_entregas_pendentes
          WHERE cliente_id = ? AND venda_id > 0
          ORDER BY venda_id ASC
          LIMIT 200`,
        [clientId],
      );
      const [requests] = await pool.execute(
        `SELECT id, venda_id, status, resultado, erro,
                DATE_FORMAT(solicitado_em, '%Y-%m-%dT%H:%i:%sZ') AS solicitado_em,
                DATE_FORMAT(aplicado_em, '%Y-%m-%dT%H:%i:%sZ') AS aplicado_em
           FROM clientes_sistema_entregas_baixas
          WHERE cliente_id = ? AND status <> 'CANCELADO'
            AND (status IN ('PENDENTE', 'PROCESSANDO')
                 OR solicitado_em > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))
          ORDER BY id DESC
          LIMIT 400`,
        [clientId],
      );
      const [syncRows] = await pool.execute(
        `SELECT DATE_FORMAT(MAX(snapshot_em), '%Y-%m-%dT%H:%i:%sZ') AS synced_at
           FROM clientes_sistema_entregas_pendentes
          WHERE cliente_id = ?`,
        [clientId],
      );
      return { rows: rows || [], requests: requests || [], syncedAt: syncRows[0]?.synced_at || null };
    },

    // Um pedido de baixa por entrega. O balcão consome a fila e faz a mesma baixa do Controle de Entregas.
    async enqueueDeliverySettlements(clientId, userId, items) {
      const [clients] = await pool.execute(
        "SELECT chave_licenca FROM clientes_sistema WHERE id = ? LIMIT 1",
        [clientId],
      );
      if (!clients[0]?.chave_licenca) return null;
      const results = [];
      for (const item of items) {
        const [pending] = await pool.execute(
          "SELECT origem FROM clientes_sistema_entregas_pendentes WHERE cliente_id = ? AND venda_id = ? LIMIT 1",
          [clientId, item.saleId],
        );
        if (!pending[0]) {
          results.push({ saleId: item.saleId, status: "not_pending" });
          continue;
        }
        if (pending[0].origem === "APP" && !item.code) {
          results.push({ saleId: item.saleId, status: "code_required" });
          continue;
        }
        const [failures] = await pool.execute(
          `SELECT COUNT(*) AS total FROM clientes_sistema_entregas_baixas
            WHERE cliente_id = ? AND venda_id = ? AND status = 'FALHOU'
              AND solicitado_em > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
          [clientId, item.saleId, REQUEST_EXPIRES_MINUTES],
        );
        if (Number(failures[0]?.total || 0) >= MAX_CODE_FAILURES) {
          results.push({ saleId: item.saleId, status: "too_many_attempts" });
          continue;
        }
        try {
          const [result] = await pool.execute(
            `INSERT INTO clientes_sistema_entregas_baixas
              (cliente_id, chave_licenca, venda_id, chave_ativa, codigo_entrega, status,
               solicitado_por_user_id, solicitado_em)
             VALUES (?, ?, ?, ?, ?, 'PENDENTE', ?, UTC_TIMESTAMP())`,
            [clientId, clients[0].chave_licenca, item.saleId, String(item.saleId), pending[0].origem === "APP" ? item.code : null, userId],
          );
          results.push({ saleId: item.saleId, status: "queued", id: Number(result.insertId) });
        } catch (error) {
          if (error?.code !== "ER_DUP_ENTRY") throw error;
          results.push({ saleId: item.saleId, status: "already_requested" });
        }
      }
      return results;
    },

    // Só dá para cancelar enquanto o balcão ainda não começou a baixar.
    async cancelDeliverySettlement(clientId, requestId) {
      const [result] = await pool.execute(
        `UPDATE clientes_sistema_entregas_baixas
            SET status = 'CANCELADO', chave_ativa = NULL, codigo_entrega = NULL
          WHERE cliente_id = ? AND id = ? AND status = 'PENDENTE'`,
        [clientId, requestId],
      );
      return Number(result.affectedRows || 0) === 1;
    },

    async cashSummaryByClientId(clientId) {
      const [rows] = await pool.execute(
        `SELECT DATE_FORMAT(data_referencia, '%Y-%m-%d') AS data_referencia,
                sessoes_abertas, sessoes_fechadas_hoje,
                total_pagamentos_hoje, saldo_inicial_aberto,
                retiradas_abertas, suprimentos_abertos,
                saldo_esperado_aberto, formas_pagamento_json, sessoes_json
           FROM clientes_sistema_caixa_resumo
          WHERE cliente_id = ?
          ORDER BY snapshot_em DESC, id DESC
          LIMIT 1`,
        [clientId],
      );
      return rows[0] || null;
    },

    async deliveryCreditSummaryByClientId(clientId, periodKey = "today") {
      const [rows] = await pool.execute(
        `SELECT DATE_FORMAT(data_referencia, '%Y-%m-%d') AS data_referencia,
                DATE_FORMAT(periodo_inicio, '%Y-%m-%d') AS periodo_inicio,
                DATE_FORMAT(periodo_fim, '%Y-%m-%d') AS periodo_fim,
                entregas_pendentes, valor_entregas_pendentes,
                entregas_urgentes, maior_espera_entrega_minutos,
                entregas_baixadas AS entregas_baixadas_hoje,
                valor_entregas_baixadas AS valor_entregas_baixadas_hoje,
                tempo_medio_entrega_minutos, fiados_pendentes,
                valor_fiado_pendente, fiados_pagos AS fiados_pagos_hoje,
                valor_fiado_pago AS valor_fiado_pago_hoje,
                fiado_mais_antigo_dias
           FROM clientes_sistema_entregas_fiado_periodos
          WHERE cliente_id = ? AND periodo_chave = ?
          ORDER BY snapshot_em DESC, id DESC
          LIMIT 1`,
        [clientId, periodKey],
      );
      if (rows[0] || periodKey !== "today") return rows[0] || null;

      const [legacyRows] = await pool.execute(
        `SELECT DATE_FORMAT(data_referencia, '%Y-%m-%d') AS data_referencia,
                DATE_FORMAT(data_referencia, '%Y-%m-%d') AS periodo_inicio,
                DATE_FORMAT(data_referencia, '%Y-%m-%d') AS periodo_fim,
                entregas_pendentes, valor_entregas_pendentes,
                entregas_urgentes, maior_espera_entrega_minutos,
                entregas_baixadas_hoje, valor_entregas_baixadas_hoje,
                tempo_medio_entrega_minutos, fiados_pendentes,
                valor_fiado_pendente, fiados_pagos_hoje,
                valor_fiado_pago_hoje, fiado_mais_antigo_dias
           FROM clientes_sistema_entregas_fiado_resumo
          WHERE cliente_id = ?
          ORDER BY snapshot_em DESC, id DESC
          LIMIT 1`,
        [clientId],
      );
      return legacyRows[0] || null;
    },

    async suspiciousActionsByClientId(clientId, periodKey = "today") {
      const [rows] = await pool.execute(
        `SELECT DATE_FORMAT(periodo_inicio, '%Y-%m-%d') AS periodo_inicio,
                DATE_FORMAT(periodo_fim, '%Y-%m-%d') AS periodo_fim,
                total_eventos,
                DATE_FORMAT(ultimo_evento_em, '%Y-%m-%d %H:%i:%s') AS ultimo_evento_em,
                categorias_json
           FROM clientes_sistema_acoes_suspeitas_periodos
          WHERE cliente_id = ? AND periodo_chave = ?
          ORDER BY snapshot_em DESC, id DESC
          LIMIT 1`,
        [clientId, periodKey],
      );
      return rows[0] || null;
    },
  };
}

module.exports = { buildClubRiskOverview, createRepository, tierForSpent };