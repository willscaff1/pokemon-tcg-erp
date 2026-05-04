# Loja ERP

Sistema local para controlar estoque, compras, vendas, faturamento e lucro de produtos variados. A interface pode manter um tema visual inspirado em Pokemon, mas a operacao nao fica limitada a TCG.

## O que ja faz

- Cadastro de produtos com SKU, variacao, fornecedor, categoria, preco de venda, custo medio e estoque minimo.
- Lancamento de compras com frete/impostos/taxas rateados no custo medio.
- Lancamento de vendas com baixa de estoque, taxas, desconto, frete cobrado, faturamento e lucro.
- Dashboard com faturamento, lucro, valor do estoque a custo, unidades e estoque baixo.
- Historico de compras, vendas e movimentacoes.
- Importacao de estoque por planilha `.xlsx` ou `.csv`, com previa antes de gravar.
- Backup/exportacao e importacao em JSON.
- Sem banco externo por enquanto: os dados ficam em `data/db.json`.

## Padrao de planilha para importar estoque

O importador reconhece estes cabecalhos:

```text
Produto | Pago | Vendido | Quantidade | SKU | Fornecedor | Categoria
```

Obrigatorios: `Produto` e `Pago`.

Regras:

- Se nao existir coluna `Quantidade`, cada linha valida vale 1 unidade.
- Linhas repetidas com o mesmo produto sao agrupadas automaticamente.
- `Pago` vira custo medio do produto.
- `Vendido` vira preco de venda quando estiver preenchido.
- `Lucro` e `Lucro%` nao devem ser importados; o sistema calcula esses valores a partir das vendas lancadas.
- Antes de gravar, o sistema mostra uma previa com produtos criados, produtos atualizados, avisos e erros.

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

Tambem funciona pelo terminal:

```bash
cd pokemon-tcg-erp
npm start
```

Abra:

```text
http://localhost:3000
```

Nao precisa instalar dependencias nesta versao.

O banco local fica em `data/db.json`. Ele foi mantido no projeto para continuar com o mesmo estoque no proximo uso. O arquivo `.env` nao deve ir para o GitHub.

## Estrutura

```text
server.js            API HTTP e arquivos estaticos
src/storage.js       Camada de dados local
public/index.html    Interface
public/styles.css    Layout
public/app.js        Regras da tela
data/db.json         Banco local criado automaticamente
```

## Preparado para Git

O arquivo `data/db.json` fica no `.gitignore`, porque contem dados da sua operacao. Para subir o codigo:

```bash
git init
git add .
git commit -m "Initial local Loja ERP"
```

## Preparado para Railway

Esta versao roda como app Node simples:

```bash
npm start
```

Variaveis suportadas:

```text
PORT=3000
DATA_FILE=./data/db.json
APP_USER=admin
APP_PASSWORD=sua-senha-forte
```

Se `APP_PASSWORD` estiver preenchida, o sistema pede login via Basic Auth. Nao publique sem senha.

Observacao importante: em deploy cloud, arquivo local pode ser efemero. Para producao no Railway, o proximo passo recomendado e trocar a camada `src/storage.js` por Postgres ou configurar volume persistente. A interface e a API ja estao separadas para facilitar essa troca.

## Proximos passos recomendados

- Login de usuario/admin antes de publicar.
- Banco Postgres para producao.
- Relatorio por periodo, canal e fornecedor.
- Modulo de contas a pagar/receber.
- Emissao fiscal real exige integracao com sistema fiscal/NF-e/NFC-e homologado.
