# Build: generate Swagger docs then build server
Set-Location $PSScriptRoot
go generate ./cmd/server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
go build -o server.exe ./cmd/server
