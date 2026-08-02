param([switch]$Force, [switch]$SkipWebp, [switch]$SkipAudio)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$imageRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'public/assets/images'))
$audioRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'public/assets/audio'))
$screenshotRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'screenshots'))
$manifestPath = Join-Path $projectRoot 'public/assets/media-optimization.json'
$magick = (Get-Command magick -ErrorAction Stop).Source
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$cutoff = if (!$Force -and (Test-Path -LiteralPath $manifestPath)) {
  (Get-Item -LiteralPath $manifestPath).LastWriteTimeUtc
} else {
  [datetime]::MinValue
}
$previousAudioOptimized = if (Test-Path -LiteralPath $manifestPath) {
  $previousManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  [int]$previousManifest.audio.optimized
} else {
  0
}

function Assert-InRoot([string]$Path, [string]$Root) {
  $resolved = [IO.Path]::GetFullPath($Path)
  if (!$resolved.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝处理资产目录之外的路径：$resolved"
  }
}

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program 执行失败，退出码 $LASTEXITCODE" }
}

$beforeBytes = (
  Get-ChildItem -LiteralPath $imageRoot, $audioRoot, $screenshotRoot -Recurse -File |
    Measure-Object -Property Length -Sum
).Sum

# 原始 PNG/JPEG 统一迁移为 WebP。若已有同名 WebP，则保留游戏正在使用的版本并移除冗余源图。
$legacyImages = Get-ChildItem -Path (Join-Path $imageRoot '*') -Recurse -File -Include '*.png', '*.jpg', '*.jpeg'
foreach ($source in $legacyImages) {
  Assert-InRoot $source.FullName $imageRoot
  $destination = [IO.Path]::ChangeExtension($source.FullName, '.webp')
  Assert-InRoot $destination $imageRoot
  if (!(Test-Path -LiteralPath $destination)) {
    Invoke-Checked $magick @(
      $source.FullName, '-auto-orient', '-strip', '-resize', '1280x1280>',
      '-quality', '78', '-define', 'webp:method=6', $destination
    )
  }
  if (!(Test-Path -LiteralPath $destination) -or (Get-Item -LiteralPath $destination).Length -eq 0) {
    throw "WebP 转换结果无效：$destination"
  }
  Remove-Item -LiteralPath $source.FullName
}

$optimizedImages = 0
$webpImages = Get-ChildItem -LiteralPath $imageRoot -Recurse -Filter '*.webp' -File
foreach ($image in $webpImages) {
  if ($SkipWebp) { continue }
  if (!$Force -and $image.LastWriteTimeUtc -le $cutoff) { continue }
  Assert-InRoot $image.FullName $imageRoot
  $temp = Join-Path $image.DirectoryName ($image.BaseName + '.optimizing.webp')
  Invoke-Checked $magick @(
    $image.FullName, '-auto-orient', '-strip', '-resize', '1280x1280>',
    '-quality', '78', '-define', 'webp:method=6', $temp
  )
  if ((Get-Item -LiteralPath $temp).Length -eq 0) { throw "图片压缩结果为空：$($image.FullName)" }
  Move-Item -LiteralPath $temp -Destination $image.FullName -Force
  $optimizedImages += 1
}

# QA 截图保留原文件名供报告引用，使用调色板 PNG + 最高压缩级别原位优化。
$screenshots = Get-ChildItem -Path (Join-Path $screenshotRoot '*') -Recurse -File -Include '*.png'
foreach ($image in $screenshots) {
  if (!$Force -and $image.LastWriteTimeUtc -le $cutoff) { continue }
  Assert-InRoot $image.FullName $screenshotRoot
  $temp = Join-Path $image.DirectoryName ($image.BaseName + '.optimizing.png')
  Invoke-Checked $magick @(
    $image.FullName, '-strip', '-colors', '256', '-define', 'png:compression-level=9', $temp
  )
  if ((Get-Item -LiteralPath $temp).Length -eq 0) { throw "截图压缩结果为空：$($image.FullName)" }
  Move-Item -LiteralPath $temp -Destination $image.FullName -Force
  $optimizedImages += 1
}

$optimizedAudio = if ($SkipAudio) { $previousAudioOptimized } else { 0 }
$audioFiles = Get-ChildItem -LiteralPath $audioRoot -Recurse -File |
  Where-Object { $_.Extension -in '.mp3', '.ogg' }
foreach ($audio in $audioFiles) {
  if ($SkipAudio) { continue }
  if (!$Force -and $audio.LastWriteTimeUtc -le $cutoff) { continue }
  Assert-InRoot $audio.FullName $audioRoot
  $relative = $audio.FullName.Substring($audioRoot.Length).Replace('\', '/')
  $isMusic = $relative.StartsWith('/music/', [StringComparison]::OrdinalIgnoreCase)
  $isVoice = $relative.StartsWith('/voice/', [StringComparison]::OrdinalIgnoreCase)
  $targetLufs = if ($isMusic) { -18 } elseif ($isVoice) { -16 } else { -14 }
  $bitrate = if ($isMusic) { '96k' } elseif ($isVoice) { '48k' } else { '64k' }
  $codec = if ($audio.Extension -eq '.ogg') { 'libvorbis' } else { 'libmp3lame' }
  $temp = Join-Path $audio.DirectoryName ($audio.BaseName + '.optimizing' + $audio.Extension)
  $arguments = @(
    '-y', '-hide_banner', '-loglevel', 'error', '-i', $audio.FullName,
    '-vn', '-map_metadata', '-1', '-af', "loudnorm=I=$targetLufs`:TP=-1.5:LRA=11",
    '-ar', '44100'
  )
  if ($isVoice) { $arguments += @('-ac', '1') }
  $arguments += @('-codec:a', $codec, '-b:a', $bitrate, $temp)
  Invoke-Checked $ffmpeg $arguments
  if ((Get-Item -LiteralPath $temp).Length -eq 0) { throw "音频压缩结果为空：$($audio.FullName)" }
  Move-Item -LiteralPath $temp -Destination $audio.FullName -Force
  $optimizedAudio += 1
}

# 运行时只使用 MP3 版本；保留剧情实际引用的四条 OGG 语音，移除重复音乐与旧 SFX。
$unusedOgg = @('music/battle_theme.ogg', 'music/defeat.ogg', 'music/victory.ogg', 'sfx/attack_hit.ogg', 'sfx/attack_swing.ogg', 'sfx/card_flip.ogg', 'sfx/combo_powerup.ogg', 'sfx/uno_cheer.ogg')
foreach ($relativePath in $unusedOgg) {
  $target = Join-Path $audioRoot $relativePath
  Assert-InRoot $target $audioRoot
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
}

$afterBytes = (
  Get-ChildItem -LiteralPath $imageRoot, $audioRoot, $screenshotRoot -Recurse -File |
    Measure-Object -Property Length -Sum
).Sum
$manifest = [ordered]@{
  version = 1
  generatedAt = [datetime]::UtcNow.ToString('o')
  image = [ordered]@{ format = 'WebP'; quality = 78; maxDimension = 1280; optimized = $optimizedImages }
  audio = [ordered]@{
    music = '-18 LUFS / 96 kbps'
    voice = '-16 LUFS / 48 kbps mono'
    sfx = '-14 LUFS / 64 kbps'
    truePeak = '-1.5 dBTP'
    optimized = $optimizedAudio
  }
  beforeBytes = $beforeBytes
  afterBytes = $afterBytes
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8
$beforeMiB = [math]::Round($beforeBytes / 1MB, 2)
$afterMiB = [math]::Round($afterBytes / 1MB, 2)
Write-Output "Media optimized: images=$optimizedImages audio=$optimizedAudio size=$beforeMiB MiB -> $afterMiB MiB"
