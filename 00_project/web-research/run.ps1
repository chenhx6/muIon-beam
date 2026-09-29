param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('crawl4ai', 'browser-use')]
    [string]$Tool,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PythonArgs
)

$privateRoot = Join-Path $PSScriptRoot 'private'
$env:HOME = Join-Path $privateRoot 'home'
$env:USERPROFILE = $env:HOME
$env:APPDATA = Join-Path $privateRoot 'appdata'
$env:LOCALAPPDATA = Join-Path $privateRoot 'localappdata'
$env:TEMP = Join-Path $privateRoot 'temp'
$env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = Join-Path $privateRoot 'pip-cache'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $privateRoot 'browsers'
$env:CRAWL4_AI_BASE_DIRECTORY = Join-Path $privateRoot 'crawl4ai'
$env:BROWSER_USE_HOME = Join-Path $privateRoot 'browser-use'
$env:BROWSER_USE_CONFIG_DIR = Join-Path $env:BROWSER_USE_HOME 'config'
$env:XDG_CACHE_HOME = Join-Path $privateRoot 'xdg-cache'
$env:XDG_CONFIG_HOME = Join-Path $privateRoot 'xdg-config'
$env:HF_HOME = Join-Path $privateRoot 'huggingface'
$env:NLTK_DATA = Join-Path $privateRoot 'nltk'
$env:TORCH_HOME = Join-Path $privateRoot 'torch'
$env:PYTHONIOENCODING = 'utf-8'

foreach ($directory in @($env:HOME, $env:APPDATA, $env:LOCALAPPDATA, $env:TEMP, $env:PIP_CACHE_DIR, $env:PLAYWRIGHT_BROWSERS_PATH, $env:CRAWL4_AI_BASE_DIRECTORY, $env:BROWSER_USE_HOME, $env:BROWSER_USE_CONFIG_DIR, $env:XDG_CACHE_HOME, $env:XDG_CONFIG_HOME, $env:HF_HOME, $env:NLTK_DATA, $env:TORCH_HOME)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$python = Join-Path $PSScriptRoot "venvs/$Tool/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $python)) { throw "Project-local $Tool environment is missing: $python" }
& $python @PythonArgs
exit $LASTEXITCODE
