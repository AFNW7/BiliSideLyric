$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$story = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'storyboard.json') -Raw | ConvertFrom-Json
$outputRoot = Join-Path $PSScriptRoot 'output\voice'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $preferred = @('Microsoft Yaoyao', 'Microsoft Huihui', 'Microsoft Huihui Desktop')
  $installed = @($speaker.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
  $selected = $preferred | Where-Object { $_ -in $installed } | Select-Object -First 1
  if (-not $selected) { throw '需要本机安装中文语音才能重新生成旁白。' }
  $speaker.SelectVoice($selected)
  $speaker.Rate = 1
  $speaker.Volume = 90
  for ($index = 0; $index -lt $story.scenes.Count; $index++) {
    $path = Join-Path $outputRoot ("scene-{0:d2}.wav" -f $index)
    $speaker.SetOutputToWaveFile($path)
    $speaker.Speak($story.scenes[$index].narration)
    $speaker.SetOutputToNull()
  }
  Write-Output "Chinese narration generated with $selected"
} finally { $speaker.Dispose() }
