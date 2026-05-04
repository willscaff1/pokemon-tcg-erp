$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Write-Host "Destino configurado: https://github.com/willscaff1/pokemon-tcg-erp"
Write-Host "Antes de rodar, crie um repositorio vazio no GitHub com o nome: pokemon-tcg-erp"
Write-Host ""

git remote set-url origin https://github.com/willscaff1/pokemon-tcg-erp.git
git branch -M main
git push -u origin main
