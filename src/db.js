const mysql = require("mysql2/promise");

function createPool(config) {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: "Z",
    ssl: config.ssl ? {} : undefined,
  });
}

async function addColumnIfMissing(pool, table, column, definition) {
  try {
    await pool.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

async function initializeDatabase(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS portal_gestor_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(254) NOT NULL,
      password_salt CHAR(32) NOT NULL,
      password_hash CHAR(128) NOT NULL,
      password_change_required TINYINT NOT NULL DEFAULT 0,
      active TINYINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_portal_gestor_user_email (email),
      KEY idx_portal_gestor_user_client (cliente_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  try {
    await pool.execute(
      "ALTER TABLE portal_gestor_users ADD COLUMN password_change_required TINYINT NOT NULL DEFAULT 0 AFTER password_hash",
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS portal_gestor_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_portal_gestor_session_token (token_hash),
      KEY idx_portal_gestor_session_user (user_id),
      KEY idx_portal_gestor_session_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  try {
    await pool.execute(
      "ALTER TABLE portal_gestor_sessions ADD COLUMN remember TINYINT NOT NULL DEFAULT 0 AFTER expires_at",
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  }
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS portal_gestor_password_resets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_portal_gestor_reset_token (token_hash),
      KEY idx_portal_gestor_reset_user (user_id),
      KEY idx_portal_gestor_reset_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Recurso opcional: se a tabela não puder ser criada, o restante do portal continua funcionando.
  try {
    await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_notas_entrada (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      origem VARCHAR(10) NOT NULL DEFAULT 'XML',
      chave_nfe CHAR(44) NULL,
      chave_ativa VARCHAR(64) NULL,
      chave_dedupe VARCHAR(64) NOT NULL DEFAULT '',
      numero_nf VARCHAR(20) NOT NULL DEFAULT '',
      serie VARCHAR(5) NOT NULL DEFAULT '',
      emissao DATE NULL,
      fornecedor_nome VARCHAR(200) NOT NULL DEFAULT '',
      fornecedor_documento VARCHAR(20) NOT NULL DEFAULT '',
      valor_nf DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      total_itens INT NOT NULL DEFAULT 0,
      itens_json LONGTEXT NOT NULL,
      extras_json LONGTEXT NOT NULL,
      xml_conteudo LONGTEXT NULL,
      observacoes VARCHAR(500) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      itens_atualizados INT NOT NULL DEFAULT 0,
      itens_criados INT NOT NULL DEFAULT 0,
      itens_ignorados INT NOT NULL DEFAULT 0,
      resultado_json LONGTEXT NULL,
      solicitado_por_user_id BIGINT UNSIGNED NOT NULL,
      solicitado_em DATETIME NOT NULL,
      processando_em DATETIME NULL,
      aplicado_em DATETIME NULL,
      erro VARCHAR(500) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_notas_entrada_chave_ativa (cliente_id, chave_ativa),
      KEY idx_notas_entrada_fila (chave_licenca, status, id),
      KEY idx_notas_entrada_cliente (cliente_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  } catch (error) {
    console.error(`Tabela de notas de entrada não criada: ${error.code || ""} ${error.message}`);
  }
  // Baixa de entregas pelo portal: o balcão publica as pendentes e consome a fila de pedidos de baixa.
  try {
    await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_entregas_pendentes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      venda_id BIGINT NOT NULL,
      venda_em DATETIME NULL,
      hora_venda VARCHAR(5) NOT NULL DEFAULT '',
      espera_minutos INT NOT NULL DEFAULT 0,
      valor DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      cliente_nome VARCHAR(80) NOT NULL DEFAULT '',
      entregador_nome VARCHAR(80) NOT NULL DEFAULT '',
      pagamento VARCHAR(40) NOT NULL DEFAULT '',
      origem VARCHAR(10) NOT NULL DEFAULT 'BALCAO',
      pedido_app_numero VARCHAR(40) NOT NULL DEFAULT '',
      snapshot_em DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_entregas_pend_venda (chave_licenca, venda_id),
      KEY idx_entregas_pend_cliente (cliente_id, venda_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
    await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_entregas_baixas (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      venda_id BIGINT NOT NULL,
      chave_ativa VARCHAR(40) NULL,
      codigo_entrega VARCHAR(4) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      resultado VARCHAR(20) NULL,
      erro VARCHAR(300) NULL,
      solicitado_por_user_id BIGINT UNSIGNED NOT NULL,
      solicitado_em DATETIME NOT NULL,
      processando_em DATETIME NULL,
      aplicado_em DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_entregas_baixas_ativa (cliente_id, chave_ativa),
      KEY idx_entregas_baixas_fila (chave_licenca, status, id),
      KEY idx_entregas_baixas_venda (cliente_id, venda_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  } catch (error) {
    console.error(`Tabelas de baixa de entregas não criadas: ${error.code || ""} ${error.message}`);
  }
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_metricas_diarias (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      data_referencia DATE NOT NULL,
      qtd_vendas INT NOT NULL DEFAULT 0,
      valor_vendas DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      qtd_trocas INT NOT NULL DEFAULT 0,
      valor_trocas DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      qtd_devolucoes INT NOT NULL DEFAULT 0,
      valor_devolucoes DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      qtd_cancelamentos INT NOT NULL DEFAULT 0,
      valor_cancelamentos DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_metricas_diarias_licenca_data (chave_licenca, data_referencia),
      KEY idx_metricas_diarias_cliente_data (cliente_id, data_referencia)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_campanhas (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      campanha_origem_id BIGINT NOT NULL,
      nome VARCHAR(200) NOT NULL,
      ativa TINYINT NOT NULL DEFAULT 0,
      modo VARCHAR(20) NOT NULL DEFAULT 'LOCAL',
      data_inicio DATE NOT NULL,
      data_fim DATE NOT NULL,
      premios_json LONGTEXT NOT NULL,
      participacoes INT NOT NULL DEFAULT 0,
      ganhadores INT NOT NULL DEFAULT 0,
      retirados INT NOT NULL DEFAULT 0,
      pendentes INT NOT NULL DEFAULT 0,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_campanhas_licenca_origem (chave_licenca, campanha_origem_id),
      KEY idx_campanhas_cliente_ativa (cliente_id, ativa, data_fim)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_campanhas_resultados (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      participacao_origem_id BIGINT NOT NULL,
      campanha_origem_id BIGINT NOT NULL,
      campanha_nome VARCHAR(200) NOT NULL,
      premio_nome VARCHAR(200) NOT NULL,
      codigo_final VARCHAR(3) NOT NULL,
      data_hora DATETIME NOT NULL,
      retirado TINYINT NOT NULL DEFAULT 0,
      retirado_em DATETIME NULL,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_resultados_licenca_origem (chave_licenca, participacao_origem_id),
      KEY idx_resultados_cliente_data (cliente_id, data_hora)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_estoque_resumo (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      produtos_ativos INT NOT NULL DEFAULT 0,
      unidades_estoque DECIMAL(16,3) NOT NULL DEFAULT 0,
      sem_estoque INT NOT NULL DEFAULT 0,
      estoque_baixo INT NOT NULL DEFAULT 0,
      vencidos INT NOT NULL DEFAULT 0,
      vencendo_60_dias INT NOT NULL DEFAULT 0,
      sem_validade INT NOT NULL DEFAULT 0,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_estoque_resumo_licenca (chave_licenca),
      KEY idx_estoque_resumo_cliente (cliente_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_estoque_alertas (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      produto_origem_id BIGINT NOT NULL,
      codigo VARCHAR(100) NOT NULL DEFAULT '',
      nome VARCHAR(255) NOT NULL,
      categoria VARCHAR(100) NOT NULL DEFAULT '',
      estoque_atual DECIMAL(14,3) NOT NULL DEFAULT 0,
      estoque_minimo DECIMAL(14,3) NOT NULL DEFAULT 0,
      validade DATE NULL,
      sem_estoque TINYINT NOT NULL DEFAULT 0,
      estoque_baixo TINYINT NOT NULL DEFAULT 0,
      vencido TINYINT NOT NULL DEFAULT 0,
      sem_validade TINYINT NOT NULL DEFAULT 0,
      dias_para_vencer INT NULL,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_estoque_alerta_licenca_produto (chave_licenca, produto_origem_id),
      KEY idx_estoque_alerta_cliente_prioridade (cliente_id, vencido, sem_estoque, dias_para_vencer)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_produtos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      produto_origem_id BIGINT NOT NULL,
      codigo VARCHAR(100) NOT NULL DEFAULT '',
      nome VARCHAR(255) NOT NULL,
      preco_venda DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      estoque INT NOT NULL DEFAULT 0,
      ativo TINYINT NOT NULL DEFAULT 1,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_produtos_licenca_origem (chave_licenca, produto_origem_id),
      KEY idx_produtos_cliente_nome (cliente_id, nome),
      KEY idx_produtos_cliente_codigo (cliente_id, codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_produto_atualizacoes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      produto_origem_id BIGINT NOT NULL,
      nome VARCHAR(255) NOT NULL,
      preco_venda DECIMAL(14,2) NOT NULL,
      estoque INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      solicitado_por_user_id BIGINT UNSIGNED NOT NULL,
      solicitado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processando_em DATETIME NULL,
      aplicado_em DATETIME NULL,
      erro VARCHAR(500) NULL,
      PRIMARY KEY (id),
      KEY idx_produto_atualizacoes_fila (chave_licenca, status, id),
      KEY idx_produto_atualizacoes_cliente (cliente_id, produto_origem_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_caixa_resumo (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      data_referencia DATE NOT NULL,
      sessoes_abertas INT NOT NULL DEFAULT 0,
      sessoes_fechadas_hoje INT NOT NULL DEFAULT 0,
      total_pagamentos_hoje DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      saldo_inicial_aberto DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      retiradas_abertas DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      suprimentos_abertos DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      saldo_esperado_aberto DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      formas_pagamento_json LONGTEXT NOT NULL,
      sessoes_json LONGTEXT NOT NULL,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_caixa_resumo_licenca (chave_licenca),
      KEY idx_caixa_resumo_cliente (cliente_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing(pool, "clientes_sistema_estoque_resumo", "valor_estoque_custo", "DECIMAL(16,2) NOT NULL DEFAULT 0.00");
  for (const [column, definition] of [
    ["categoria", "VARCHAR(100) NOT NULL DEFAULT ''"],
    ["preco_promocional", "DECIMAL(14,2) NULL"],
    ["promo_qtd", "INT NULL"],
    ["promo_preco_pacote", "DECIMAL(14,2) NULL"],
    ["validade", "DATE NULL"],
    ["estoque_minimo", "INT NOT NULL DEFAULT 0"],
    ["tipo_modelo", "TINYINT NOT NULL DEFAULT 0"],
    ["detalhes", "TINYINT NOT NULL DEFAULT 0"],
    ["fator_conversao_padrao", "INT NOT NULL DEFAULT 1"],
    ["unidade_compra", "VARCHAR(10) NOT NULL DEFAULT 'UN'"],
  ]) {
    await addColumnIfMissing(pool, "clientes_sistema_produtos", column, definition);
  }
  for (const [column, definition] of [
    ["preco_promocional", "DECIMAL(14,2) NULL"],
    ["promo_qtd", "INT NULL"],
    ["promo_preco_pacote", "DECIMAL(14,2) NULL"],
    ["promo_alterada", "TINYINT NOT NULL DEFAULT 0"],
  ]) {
    await addColumnIfMissing(pool, "clientes_sistema_produto_atualizacoes", column, definition);
  }
  await addColumnIfMissing(pool, "clientes_sistema_caixa_resumo", "sessoes_json", "LONGTEXT NOT NULL");
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_entregas_fiado_resumo (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      data_referencia DATE NOT NULL,
      entregas_pendentes INT NOT NULL DEFAULT 0,
      valor_entregas_pendentes DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      entregas_urgentes INT NOT NULL DEFAULT 0,
      maior_espera_entrega_minutos INT NOT NULL DEFAULT 0,
      entregas_baixadas_hoje INT NOT NULL DEFAULT 0,
      valor_entregas_baixadas_hoje DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      tempo_medio_entrega_minutos INT NOT NULL DEFAULT 0,
      fiados_pendentes INT NOT NULL DEFAULT 0,
      valor_fiado_pendente DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      fiados_pagos_hoje INT NOT NULL DEFAULT 0,
      valor_fiado_pago_hoje DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      fiado_mais_antigo_dias INT NOT NULL DEFAULT 0,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_entregas_fiado_licenca (chave_licenca),
      KEY idx_entregas_fiado_cliente (cliente_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_entregas_fiado_periodos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      periodo_chave VARCHAR(20) NOT NULL,
      periodo_inicio DATE NOT NULL,
      periodo_fim DATE NOT NULL,
      data_referencia DATE NOT NULL,
      entregas_pendentes INT NOT NULL DEFAULT 0,
      valor_entregas_pendentes DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      entregas_urgentes INT NOT NULL DEFAULT 0,
      maior_espera_entrega_minutos INT NOT NULL DEFAULT 0,
      entregas_baixadas INT NOT NULL DEFAULT 0,
      valor_entregas_baixadas DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      tempo_medio_entrega_minutos INT NOT NULL DEFAULT 0,
      fiados_pendentes INT NOT NULL DEFAULT 0,
      valor_fiado_pendente DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      fiados_pagos INT NOT NULL DEFAULT 0,
      valor_fiado_pago DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      fiado_mais_antigo_dias INT NOT NULL DEFAULT 0,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_entregas_fiado_periodo (chave_licenca, periodo_chave),
      KEY idx_entregas_fiado_periodo_cliente (cliente_id, periodo_chave)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clientes_sistema_acoes_suspeitas_periodos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id INT NOT NULL,
      chave_licenca VARCHAR(64) NOT NULL,
      periodo_chave VARCHAR(20) NOT NULL,
      periodo_inicio DATE NOT NULL,
      periodo_fim DATE NOT NULL,
      total_eventos INT NOT NULL DEFAULT 0,
      ultimo_evento_em DATETIME NULL,
      categorias_json TEXT NOT NULL,
      snapshot_em DATETIME NOT NULL,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_acoes_suspeitas_periodo (chave_licenca, periodo_chave),
      KEY idx_acoes_suspeitas_cliente (cliente_id, periodo_chave)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

module.exports = { createPool, initializeDatabase };