$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
Write-Host "Iniciando Loja ERP em http://localhost:3000"
npm start
