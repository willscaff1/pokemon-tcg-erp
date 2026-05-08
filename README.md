# Scaff TCG

Sistema para controlar estoque, compras, vendas, faturamento e lucro de produtos variados. A interface pode manter um tema visual inspirado em Pokémon, mas a operação não fica limitada a TCG.

## O que já faz

- Cadastro de produtos com foto, SKU, variação, fornecedor, categoria, preço de compra, preço de venda, custo médio, margem e estoque mínimo.
- Lançamento de compras com frete, impostos e taxas rateados no custo médio.
- Lançamento de vendas com baixa de estoque, taxas, desconto, frete cobrado, preço real da venda, faturamento e lucro.
- Dashboard com faturamento, lucro, valor do estoque a custo, unidades e estoque baixo.
- Tela de projeção com média de margem e faturamento estimado caso venda todo o estoque.
- Histórico de compras, vendas e movimentações.
- Relatório em PDF para cliente com logo, foto do produto, nome e preço de venda.
- Importação de estoque por planilha `.xlsx` ou `.csv`, com prévia antes de gravar.
- Backup/exportação e importação em JSON.
- Banco local em JSON ou Postgres quando `DATABASE_URL` estiver configurada.

## Padrão de planilha para importar estoque

O importador reconhece estes cabeçalhos:

```text
Produto | Pago | Vendido | Quantidade | SKU | Fornecedor | Categoria
```

Obrigatórios: `Produto` e `Pago`.

Regras:

- Se não existir coluna `Quantidade`, cada linha válida vale 1 unidade.
- Linhas repetidas com o mesmo produto são agrupadas automaticamente.
- `Pago` vira custo médio do produto.
- `Vendido` vira preço de venda quando estiver preenchido.
- `Lucro` e `Lucro%` não devem ser importados; o sistema calcula esses valores a partir das vendas lançadas.
- Antes de gravar, o sistema mostra uma prévia com produtos criados, produtos atualizados, avisos e erros.

## Como rodar local

Requisitos: Node.js 18 ou superior.

Jeito mais simples no Windows:

```text
start-erp.bat
```

Depois abra:

```text
http://localhost:3000
```

Também funciona pelo terminal:

```bash
cd pokemon-tcg-erp
npm install
npm start
```

Abra:

```text
http://localhost:3000
```

O banco local fica em `data/db.json`. O arquivo `.env` não deve ir para o GitHub.

## Estrutura

```text
server.js            API HTTP e arquivos estaticos
src/storage.js       Camada de dados local/Postgres
public/index.html    Interface
public/styles.css    Layout
public/app.js        Regras da tela
data/db.json         Banco local criado automaticamente
```

## Preparado para Railway

Esta versão roda como app Node simples:

```bash
npm start
```

Variáveis suportadas:

```text
PORT=3000
DATA_FILE=./data/db.json
DATABASE_URL=postgresql://...
PGSSLMODE=require
APP_USER=admin
APP_PASSWORD=sua-senha-forte
```

Se `APP_PASSWORD` estiver preenchida, o sistema pede login via Basic Auth. Não publique sem senha.

Quando `DATABASE_URL` existe, o sistema grava os dados no Postgres. Se não existir, grava no `data/db.json` local.

## Migrar dados para Postgres

Depois de criar ou conectar o Postgres no Railway, rode a migração apontando para a mesma `DATABASE_URL`:

```bash
npm run migrate:postgres
```

Se o projeto já estiver linkado no Railway CLI, rode:

```bash
railway run npm run migrate:postgres
```

O comando lê `data/db.json` e grava tudo na tabela `app_state` do Postgres. Para usar outro arquivo de origem:

```text
MIGRATION_DATA_FILE=./caminho/do/backup.json
```

Em deploy cloud, arquivo local pode ser efêmero. Para produção no Railway, use Postgres.

## Próximos passos recomendados

- Relatório por período, canal e fornecedor.
- Módulo de contas a pagar/receber.
- Emissão fiscal real exige integração com sistema fiscal/NF-e/NFC-e homologado.
