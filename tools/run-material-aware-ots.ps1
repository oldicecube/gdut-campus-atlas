$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$otsRoot=if($env:OTS_ROOT){$env:OTS_ROOT}else{'D:\Cube GDUT\ObjToSchematic-src\ObjToSchematic-ots-1.0'}
$manifest=Get-Content -LiteralPath (Join-Path $repo 'output/material-aware-static-shards/manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
$runRoot=Join-Path $repo 'output/material-aware-ots'
New-Item -ItemType Directory -Force -Path $runRoot | Out-Null
$env:NODE_OPTIONS='--max-old-space-size=8192'
$python=Join-Path $repo '..\.venv-litemapy\Scripts\python.exe'
if(-not (Test-Path -LiteralPath $python)){$python='python'}
& $python (Join-Path $repo 'tools/patch-ots-material-aware.py') $otsRoot
if($LASTEXITCODE -ne 0){throw 'failed to patch ObjToSchematic'}
Push-Location $otsRoot
& npm.cmd run build
if($LASTEXITCODE -ne 0){throw 'ObjToSchematic build failed'}
try {
 foreach($s in $manifest.shards){
  $name=$s.name
  $input=Join-Path $repo ($s.file -replace '/', '\\')
  $out=Join-Path $runRoot ("ots-"+$name)
  if(Test-Path -LiteralPath (Join-Path $out 'output.json')) { Write-Host "=== skip completed $name ==="; continue }
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $size=('{0:0.######}' -f [double]$s.objToSchematicSize)
  Write-Host "=== material-aware OTS $name size=$size ==="
  & npx.cmd ts-node --files --require (Join-Path $otsRoot 'tools/require-hook.cjs') (Join-Path $otsRoot 'tools/run-headless.ts') $input $out indexed_json --size $size --axis y
  if($LASTEXITCODE -ne 0){ throw "OTS failed for $name ($LASTEXITCODE)" }
 }
} finally { Pop-Location }
