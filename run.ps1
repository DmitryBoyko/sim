# Run: generate Swagger docs then run server
Set-Location $PSScriptRoot
go generate ./cmd/server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
go run ./cmd/server
