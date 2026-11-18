$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = Join-Path $taskRoot 'release'
$version = (Get-Content -LiteralPath (Join-Path $taskRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$stagingRoot = Join-Path $releaseRoot "SideLyric-$version"
$archivePath = Join-Path $releaseRoot "SideLyric-$version.zip"
if (Test-Path -LiteralPath $stagingRoot) {
  foreach ($entry in Get-ChildItem -LiteralPath $stagingRoot) {
    if ($entry.Name -notin @('manifest.json', 'README.md', 'TESTING.md', 'src', 'assets')) {
      throw "暂存目录存在额外内容，请先检查：$($entry.FullName)"
    }
  }
}
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
foreach ($name in @('manifest.json', 'README.md', 'TESTING.md', 'src', 'assets')) {
  Copy-Item -LiteralPath (Join-Path $taskRoot $name) -Destination $stagingRoot -Recurse -Force
}
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $stagingRoot | Select-Object -ExpandProperty FullName) -DestinationPath $archivePath -Force
Get-Item -LiteralPath $archivePath | Select-Object FullName, Length
