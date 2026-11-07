[CmdletBinding()]
param([ValidateSet("Debug", "Release")][string] $Configuration = "Debug", [switch] $Offline, [ValidateSet("Auto", "Mobile", "Personal")][string] $Edition = "Auto")
$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repository "apps/android-vutron"
$identityJson = & node (Join-Path $PSScriptRoot 'mobile-build.cjs') $Edition.ToLowerInvariant()
if ($LASTEXITCODE -ne 0) { throw 'Build edition rules rejected the requested configuration.' }
$identity = $identityJson | ConvertFrom-Json
$previousEdition = $env:VUTRON_BUILD_EDITION
$env:VUTRON_BUILD_EDITION = $identity.edition
Write-Output ("Build edition: " + $identity.edition + " / " + $identity.version)
Push-Location $app
try {
    if (-not (Test-Path -LiteralPath "node_modules")) {
        & npm.cmd ci --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw "Mobile dependency installation failed." }
    }
    Push-Location (Join-Path $repository 'packages/plugin-api')
    try {
        $pluginManifest = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
        $pluginDependenciesReady = (Test-Path -LiteralPath 'node_modules/zod/package.json') -and (Test-Path -LiteralPath 'node_modules/regexpu-core/package.json')
        if ($pluginDependenciesReady) {
            $installedZod = Get-Content -LiteralPath 'node_modules/zod/package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
            $installedRegexpu = Get-Content -LiteralPath 'node_modules/regexpu-core/package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
            $pluginDependenciesReady = $installedZod.version -eq $pluginManifest.dependencies.zod -and $installedRegexpu.version -eq $pluginManifest.devDependencies.'regexpu-core'
        }
        if (-not $pluginDependenciesReady) {
            & npm.cmd ci --ignore-scripts
            if ($LASTEXITCODE -ne 0) { throw 'Plugin API dependency installation failed.' }
        }
        & node (Join-Path $repository 'scripts/build-plugin-api.cjs')
        if ($LASTEXITCODE -ne 0) { throw 'Plugin API generation failed.' }
    } finally { Pop-Location }
    Push-Location (Join-Path $repository 'packages/plugin-runtime-deps')
    try {
        if (-not (Test-Path -LiteralPath 'node_modules/@neteasecloudmusicapienhanced/api/package.json')) {
            & npm.cmd ci --ignore-scripts --omit=dev
            if ($LASTEXITCODE -ne 0) { throw 'Plugin runtime dependency installation failed.' }
        }
        & node (Join-Path $repository 'scripts/vendor-plugin-dependencies.cjs')
        if ($LASTEXITCODE -ne 0) { throw 'Plugin runtime dependency preparation failed.' }
        & node (Join-Path $repository 'scripts/runtime-regex-compat.cjs') --check
        if ($LASTEXITCODE -ne 0) { throw 'Plugin runtime Unicode compatibility check failed.' }
    } finally { Pop-Location }
    & node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
    if ($LASTEXITCODE -ne 0) { throw "Mobile TypeScript check failed." }
    $savedPreference = $ErrorActionPreference
    try {
        # Windows PowerShell otherwise treats successful native stderr warnings as failures.
        $ErrorActionPreference = "Continue"
        & npm.cmd run build
        $frontendExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($frontendExitCode -ne 0) { throw "Mobile frontend build failed." }
    & npm.cmd exec -- cap sync android
    if ($LASTEXITCODE -ne 0) { throw "Capacitor sync failed." }
    Push-Location android
    try {
        $arguments = @((":app:assemble" + $Configuration), "--console=plain", ("-PvutronEdition=" + $identity.edition))
        if ($Offline) { $arguments += "--offline" }
        $savedPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            & .\gradlew.bat @arguments
            $gradleExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedPreference }
        if ($gradleExitCode -ne 0) { throw "Android build failed." }
    } finally { Pop-Location }
    Write-Output ("APK output: " + (Join-Path $app ("android/app/build/outputs/apk/" + $Configuration.ToLowerInvariant())))
} finally { Pop-Location; $env:VUTRON_BUILD_EDITION = $previousEdition }
