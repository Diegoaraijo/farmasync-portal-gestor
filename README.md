# FarmaSync Portal Gestor

> Código-fonte entregue como parte do trabalho da disciplina **Gestão e Qualidade de Software**. Testes: `npm test` (dentro desta pasta, após `npm install`).

Portal web multiempresa para os gestores acompanharem os snapshots operacionais enviados pelo FarmaSync. O painel inclui o resumo de hoje, histórico agregado de vendas, Clube Digital, campanhas, estoque, validade, caixa, entregas, fiado e ações suspeitas, sem transferir vendas ou clientes individuais.

## Execução local

Requer Node.js 20 ou superior e acesso ao banco SaaS que contém `clientes_sistema` e `clientes_sistema_metricas`.

1. Copie `.env.example` para `.env` e configure o banco.
2. Exporte as variáveis no terminal ou configure-as no ambiente.
3. Execute `npm install` e `npm start`.
4. Abra `http://localhost:3000/health`.

Na primeira execução, o usuário do banco precisa criar `portal_gestor_users`, `portal_gestor_sessions`, `clientes_sistema_metricas_diarias` e as tabelas `clientes_sistema_campanhas*`, `clientes_sistema_estoque_*`, `clientes_sistema_produtos`, `clientes_sistema_produto_atualizacoes`, `clientes_sistema_notas_entrada`, `clientes_sistema_entregas_pendentes`, `clientes_sistema_entregas_baixas`, `clientes_sistema_caixa_resumo`, `clientes_sistema_entregas_fiado_*` e `clientes_sistema_acoes_suspeitas_periodos`. Depois da inicialização, precisa de `SELECT` nas tabelas SaaS, leitura dos históricos e `SELECT`, `INSERT`, `UPDATE`, `DELETE` nas tabelas `portal_gestor_*` e nas filas operacionais administradas pelo portal.

## Histórico de vendas

O FarmaSync publica agregados diários de vendas, trocas, devoluções e cancelamentos. A primeira sincronização após a atualização faz o backfill dos últimos 366 dias disponíveis no banco local; as seguintes atualizam os mesmos dias sem duplicação.

O endpoint autenticado `GET /api/sales-history?start=AAAA-MM-DD&end=AAAA-MM-DD` aceita períodos de até 366 dias e sempre deriva a farmácia da sessão do gestor. No painel, os atalhos usam períodos de calendário e o mês anterior fechado é a seleção inicial.

## Campanhas e sorteios

O FarmaSync publica a configuração e as métricas agregadas das campanhas LOCAL e ONLINE: participações, ganhadores, retirados e prêmios pendentes. O portal também mostra os ganhadores recentes com prêmio, data e situação da retirada.

O endpoint autenticado `GET /api/campaigns` deriva a farmácia da sessão. Nenhum dado pessoal, detalhe da venda, URL pública, chave de licença ou código de retirada completo é publicado. Para conferência visual, o portal recebe somente os três caracteres finais do código.

## Clube Digital

A área do Clube apresenta membros ativos, pontos em circulação, ativações, resgates, todos os membros com telefone mascarado e todos os cupons da farmácia em listas roláveis. O gestor pode cadastrar, editar, desativar e reativar benefícios sem apagar o histórico de utilização.

As rotas `GET /api/club`, `POST /api/club/coupons` e `PUT /api/club/coupons/:id` sempre derivam a farmácia da sessão autenticada. O Portal não aceita `cliente_id` do navegador e não publica telefone completo, hashes, token da loja ou códigos de resgate dos consumidores.

O Portal configura a campanha anual de aniversário, incluindo ativação, pontos de presente e antecedência mínima do cadastro. A data informada pelo membro fica bloqueada no Clube; uma correção administrativa exige motivo e registra gestor, data anterior e data nova na auditoria. Em uma nova publicação, implante primeiro o Clube Digital para criar as colunas e a fila de aniversário, e somente depois atualize o Portal Gestor.

## Produtos, estoque e validade

O FarmaSync publica um resumo por licença, até 200 produtos que exigem atenção e o catálogo ativo necessário para gestão remota: identificador local, código, nome, categoria, preço de venda, preço promocional, "leve N por R$ X", validade, estoque, estoque mínimo e tipo de modelo. O portal oferece busca por nome ou código, filtros (todos, em promoção, estoque baixo, sem estoque, vencendo) e edição responsiva em desktop e celular.

O endpoint autenticado `GET /api/inventory` mantém os indicadores de atenção. `GET /api/products?filter=&search=&limit=` lista o catálogo com `total` e `counts` por filtro; `PUT /api/products/:productId` enfileira alterações de nome, preço, estoque e, opcionalmente, promoção (`promoPrice`, `promoQty`, `promoPackagePrice`; as chaves só são enviadas quando a promoção muda). Erro de validação responde 400 com o `field`; conflitos (`pc_update_required`, `model_follows_parent`, `parent_stock_from_models`) respondem 409. Modelos de produto seguem o produto principal e o estoque do produto principal vem dos modelos. Todas as rotas derivam a farmácia e o gestor da sessão: `cliente_id`, usuário e chave enviados pelo navegador são ignorados.

O portal não escreve diretamente no banco do balcão. Cada alteração entra em `clientes_sistema_produto_atualizacoes` com a chave vinculada ao catálogo daquele cliente. O FarmaSync consulta a fila durante o ciclo de licença, normalmente a cada dez segundos, reivindica cada comando de forma atômica, atualiza o produto ativo e confirma `APLICADO` ou `FALHOU`. Comandos interrompidos podem ser retomados após cinco minutos. Custos, fornecedores, vendas individuais e a chave de licença não são enviados ao navegador.

## Entrada de notas

A seção "Entrada de notas" permite dar entrada nas notas de compra de qualquer lugar, com as mesmas regras de Estoque > Importar NF-e do balcão.

- **Importar XML:** o portal lê o XML (modelo 55, até 1,5 MB; DOCTYPE/entidades são recusados), valida a chave de acesso pelo dígito verificador e reconhece os produtos pelo catálogo (código exato e, depois, sem zeros à esquerda). A revisão mostra cada item com preço de compra, PMC/preço de venda, margem, promoção, categoria, uso contínuo, tipo controlado (SNGPC) e validade (a menor, quando há vários lotes). Obrigatórios, como no balcão: PMC, validade e, em produto novo, o uso contínuo (opcional só para Perfumaria). Produto com modelos não recebe estoque direto.
- **Digitar nota de papel:** fornecedor, número, emissão e, opcionalmente, CNPJ/CPF e chave de acesso; produtos buscados no catálogo ou novos. Sem chave, a nota é identificada por fornecedor + número + data.
- **Contas a pagar:** usa as duplicatas do XML ou os vencimentos informados; sem nenhum, gera um boleto para 30 dias após a emissão. Pode ser desligado, e o fornecedor pode ser cadastrado automaticamente.
- **Fila:** `POST /api/purchase-notes` grava em `clientes_sistema_notas_entrada` (`PENDENTE`). O FarmaSync (balcão) reivindica a nota de forma atômica, lança no banco local em uma única transação e confirma `APLICADO` ou `FALHOU` com o motivo. Notas interrompidas são retomadas após cinco minutos sem somar o estoque duas vezes. A nota pode ser cancelada enquanto estiver `PENDENTE` e reenviada se `FALHOU`. A mesma nota (chave de acesso) não entra duas vezes.
- **No balcão:** soma o estoque, grava preços/validade, cria produtos novos, registra o histórico de compras, a nota em "NF-e importadas" (o XML é guardado na pasta `nfe_portal`), as contas a pagar e a entrada SNGPC dos controlados.

Rotas (todas derivam a farmácia da sessão): `GET /api/purchase-notes`, `POST /api/purchase-notes/preview` (não grava), `POST /api/purchase-notes`, `GET /api/purchase-notes/:id`, `POST /api/purchase-notes/:id/cancel` e `POST /api/purchase-notes/:id/retry`. As rotas de notas aceitam corpo de até 2,5 MB somente depois da autenticação; as demais continuam limitadas a 32 KB.

## Caixa e formas de pagamento

O FarmaSync publica a posição consolidada do dia: sessões abertas e fechadas, saldo inicial, retiradas, suprimentos, saldo esperado dos caixas abertos e totais líquidos por forma de pagamento. Troco e créditos de troca seguem a mesma consolidação usada pelo fechamento local.

O endpoint autenticado `GET /api/cash` deriva a farmácia da sessão e não publica operadores, vendas individuais, observações de caixa ou a chave de licença. As respostas autenticadas usam `Cache-Control: no-store`.

## Entregas e fiado

O FarmaSync publica somente indicadores agregados: entregas pendentes e urgentes, valores em prestação de contas, tempos de espera e baixa, parcelas de crédito da loja em aberto e recebimentos da data de referência. O valor quitado do fiado é preservado no momento da baixa para não mudar após edições posteriores na venda.

O endpoint autenticado `GET /api/deliveries-credit` deriva a farmácia da sessão e continua agregado: não traz nomes, documentos, telefones, endereços, entregadores nem vendas individuais. A idade do fiado mais antigo é informativa e não representa vencimento.

Entregas e fiado possuem filtros independentes com as opções `Hoje`, `Mês atual` e `Mês anterior`. Assim, o gestor pode comparar períodos diferentes sem alterar o outro painel. Fiados pendentes consideram a data em que a venda foi criada, enquanto recebimentos consideram a data da baixa; ambos respeitam o período selecionado. O mês anterior sempre considera o primeiro e o último dia daquele mês.

## Baixar entregas

A seção "Baixar entregas" lista as entregas pendentes e deixa o gestor baixar uma ou várias de qualquer lugar. A baixa vale em tudo: o balcão executa a mesma rotina do Controle de Entregas Pendentes (venda marcada como baixada, aviso de entrega concluída ao cliente) e, em pedido do aplicativo, conclui o pedido no servidor do app, o que também baixa o painel da farmácia.

- **Lista:** o balcão publica em `clientes_sistema_entregas_pendentes` (a cada ciclo de métricas e logo depois de cada baixa) venda, horário, espera, valor, forma de pagamento, nome **abreviado** do cliente ("Maria S."), entregador abreviado e se veio do app. Não vão telefone, endereço nem itens. O portal soma à espera o tempo desde a última sincronização e avisa quando o balcão está parado há mais de 3 minutos.
- **Fila:** `POST /api/deliveries/settle` (até 20 entregas) grava um pedido por entrega em `clientes_sistema_entregas_baixas` (`PENDENTE`). O balcão (versão 3.6.0 ou mais nova) reivindica de forma atômica, baixa e confirma `APLICADO` ou `FALHOU` com o motivo. Pedido que o balcão não pegar em 30 minutos vira `EXPIRADO` sem ser executado, e pode ser cancelado enquanto `PENDENTE`. Baixa repetida é inofensiva (`JA_BAIXADA`).
- **Pedido do aplicativo:** exige o código de segurança de 4 dígitos que o cliente mostra no app, conferido pelo servidor do app. O código fica na fila só até a execução (é apagado ao concluir, falhar, cancelar ou expirar) e nunca é devolvido pela API. Depois de 5 falhas em 30 minutos para a mesma entrega, o portal recusa novos pedidos.
- **Confirmação:** o gestor precisa marcar que o entregador retornou e a prestação de contas foi conferida. Sessões de "manter conectado" antigas pedem a senha de novo antes de baixar.

Rotas (a farmácia sempre vem da sessão): `GET /api/deliveries/pending`, `POST /api/deliveries/settle` e `POST /api/deliveries/requests/:id/cancel`.

## Ações suspeitas

O FarmaSync publica contagens de pagamento cancelado sem concluir, remoção parcial após cancelamento e carrinho esvaziado após cancelamento. Os filtros usam os períodos `Hoje`, `Mês atual` e `Mês anterior`; o painel mostra o total, a quantidade por categoria e até 100 ocorrências recentes que podem ser abertas individualmente.

Cada ocorrência informa somente categoria, data/hora, valor estimado, quantidade de linhas e unidades envolvidas. O endpoint autenticado `GET /api/suspicious-actions` deriva a farmácia da sessão. Operador, login, nomes e códigos de produtos, venda e qualquer texto livre da auditoria permanecem somente no banco local. Os eventos são sinais para revisão administrativa e não representam uma conclusão de irregularidade.

## Saúde do sincronismo

O painel monitora o último pacote operacional concluído e atualiza a consulta automaticamente a cada minuto. Até 15 minutos o estado é `Atualizado`; entre 15 e 60 minutos é `Atenção`; acima de 60 minutos é `Interrompido`. Quando nenhum pacote foi recebido, o portal informa `Sem sincronização`.

O endpoint autenticado `GET /api/sync-health` deriva a farmácia da sessão e informa apenas horário, idade e estado dos módulos. Vendas, campanhas, estoque, caixa, entregas/fiado e ações suspeitas fazem parte da mesma transação protegida, portanto o horário exibido representa o último pacote completo confirmado.

## Criar um gestor

No terminal da aplicação na Hostinger, execute com um código temporário de exatamente seis números:

```bash
PORTAL_TEMPORARY_PASSWORD="123456" npm run create-user -- "CHAVE-DA-LICENCA" "gestor@farmacia.com.br" "Nome do gestor"
```

No PowerShell local, use `$env:PORTAL_TEMPORARY_PASSWORD = "123456"` antes do comando e `Remove-Item Env:PORTAL_TEMPORARY_PASSWORD` depois dele.

O mesmo comando redefine o acesso de um e-mail já cadastrado. O código temporário deve ser entregue ao gestor por um canal separado do e-mail de acesso. No primeiro login, o portal bloqueia todos os dados operacionais e exige uma senha pessoal com pelo menos dez caracteres. O código temporário deixa de funcionar após a troca.

Para listar os gestores sem exibir senhas ou hashes:

```powershell
npm run list-users
```

A coluna `primeiro_acesso` informa `Pendente` enquanto o gestor ainda não cadastrou a senha definitiva.

## Recuperação de senha

O link `Esqueci minha senha` envia uma URL de uso único para o e-mail do gestor. O token expira em 15 minutos, é armazenado somente como hash e todas as sessões anteriores são encerradas quando a senha é redefinida. Configure `PUBLIC_BASE_URL` e as variáveis `SMTP_*` descritas em `.env.example`. Ao abrir o link, o token sai da barra de endereço e do histórico do navegador.

## Segurança

- **Login com limite de tentativas:** só as tentativas que falham contam. São 5 erros por IP + e-mail e 20 por IP em 15 minutos; depois disso o portal responde 429 com o tempo de espera e mostra o aviso na tela. Acertar a senha nunca bloqueia. Em produção o `TRUST_PROXY=1` é obrigatório para o IP real do visitante ser usado.
- **Validação:** o e-mail precisa ter formato válido (até 254 caracteres) e a senha até 128; valores de outro tipo são recusados. A tela mostra a mensagem em cada campo (ex.: "Este campo aceita somente e-mail").
- **Sem pistas para quem ataca:** e-mail inexistente e senha errada respondem igual e levam o mesmo tempo; erros da API são sempre JSON curto, sem pilha, caminho ou tecnologia.
- **Cookie de sessão** `HttpOnly`, `SameSite=Lax` e `Secure` em produção: o JavaScript da página não consegue lê-lo. Nenhum token ou chave é enviado ao navegador. O `localStorage` guarda somente o último e-mail usado e a escolha da caixa "Manter conectado" (nunca senha nem token).
- **Manter conectado:** sem a caixa marcada, a sessão dura 12 horas. Marcada, dura 30 dias de inatividade, é renovada a cada uso (no máximo uma gravação por dia) e tem teto de 90 dias desde o login. Uma sessão longa continua lendo os dados, mas qualquer alteração (`POST`/`PUT`/`DELETE`) feita mais de 12 horas após o login responde 403 `reauth_required`; o portal encerra a sessão e pede a senha de novo. Na primeira execução da v46 o portal cria a coluna `portal_gestor_sessions.remember`.
- **Cabeçalhos:** Content-Security-Policy restrita (scripts só do próprio portal), `frame-ancestors 'none'` e `X-Frame-Options: DENY` contra clickjacking, `Referrer-Policy: no-referrer`, HSTS, `nosniff` e `Permissions-Policy`.
- **Outros sites não alteram dados:** requisições de escrita vindas de outro site/origem são recusadas (`Sec-Fetch-Site`/`Origin`).
- **Limites gerais da API:** 600 requisições e 120 alterações a cada 10 minutos por IP.
- **Pacote de produção** não inclui o servidor de demonstração.

## Listas longas (área rolável)

Lista que cresce com o uso (notas enviadas, entregas pendentes, campanhas, ocorrências...) rola dentro do próprio quadro em vez de esticar a página. A classe global `.scroll-area` (em `public/styles.css`) limita a altura a 68% da tela (máximo de 560px; 64% no celular) e usa `scroll-area-cards` para listas de cartões com sombra. Em qualquer lista nova use `class="... scroll-area"` com `tabindex="0" role="region" aria-label="..."` (acessível pelo teclado); o teste `test/scroll-areas.test.js` confere as listas existentes. Dentro de janelas (`dialog`) o corpo da janela já rola, com cabeçalho e rodapé fixos.

## Versão exibida

O painel mostra "Portal vNN" no menu e no topo. O número vem do primeiro número da `version` do `package.json` (ex.: `42.0.0` → `v42`); aumente-o a cada publicação.

## Validação

```powershell
npm test
npm audit
```