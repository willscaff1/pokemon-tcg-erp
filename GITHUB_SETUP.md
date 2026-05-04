# Enviar para GitHub

O commit local ja existe neste projeto.

Como o GitHub CLI (`gh`) nao esta instalado e o repositorio `willscaff1/pokemon-tcg-erp` ainda nao existe, faca assim:

1. Acesse `https://github.com/new`.
2. Crie um repositorio vazio chamado `pokemon-tcg-erp` na conta `willscaff1`.
3. Nao marque README, .gitignore ou license no GitHub.
4. Nesta pasta, rode:

```powershell
.\push-github.ps1
```

Se o Git pedir login, autentique com sua conta `willscaff1`.

O arquivo `.env` fica fora do GitHub. O banco atual `data/db.json` esta versionado para preservar o estoque atual.
