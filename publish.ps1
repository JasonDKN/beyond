<#
.SYNOPSIS
    Publish Beyond to GitHub.

.DESCRIPTION
    The repo is already initialised and committed locally. This pushes it to a
    new GitHub repository, using the GitHub CLI when it is available and
    falling back to plain git when it is not.

.EXAMPLE
    .\publish.ps1
    .\publish.ps1 -Name beyond-korean -Public
    .\publish.ps1 -RemoteUrl https://github.com/you/Beyond.git
#>

[CmdletBinding()]
param(
    # Repository name to create on GitHub.
    [string]$Name = 'Beyond',

    # Create it public. Default is private.
    [switch]$Public,

    # Skip repo creation and push to an existing empty repo at this URL.
    [string]$RemoteUrl,

    # Rewrite the existing commits to use your git identity before pushing.
    [switch]$FixAuthor
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Step($message) { Write-Host "  $message" -ForegroundColor Cyan }
function Write-Ok($message)   { Write-Host "  $message" -ForegroundColor Green }
function Write-Warn($message) { Write-Host "  $message" -ForegroundColor Yellow }

Write-Host ''
Write-Host 'Publishing Beyond' -ForegroundColor White
Write-Host ''

# --- Sanity checks --------------------------------------------------------

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'git is not installed, or not on PATH. Install it from https://git-scm.com and try again.'
}

if (-not (Test-Path '.git')) {
    throw "No git repository here. Run this from the Beyond folder."
}

# A leftover index.lock blocks every git command and is the most likely thing
# to be in the way, so clear it rather than failing with git's cryptic message.
if (Test-Path '.git\index.lock') {
    Write-Warn 'Clearing a stale .git\index.lock'
    Remove-Item '.git\index.lock' -Force
}

# --- Optionally re-author the existing commits ----------------------------

if ($FixAuthor) {
    $email = (git config user.email)
    $name  = (git config user.name)
    if (-not $email) {
        throw 'Set your git identity first:  git config --global user.email "you@example.com"'
    }
    Write-Step "Re-authoring commits as $name <$email>"
    # Rewrites author and committer on every commit in the branch.
    git -c 'rebase.autoStash=true' filter-branch -f --env-filter @"
export GIT_AUTHOR_NAME='$name'
export GIT_AUTHOR_EMAIL='$email'
export GIT_COMMITTER_NAME='$name'
export GIT_COMMITTER_EMAIL='$email'
"@ -- --all 2>&1 | Out-Null
    Write-Ok 'Commits re-authored'
}

# --- Uncommitted work -----------------------------------------------------

$dirty = git status --porcelain
if ($dirty) {
    Write-Step 'Committing outstanding changes'
    git add -A
    git commit -q -m 'Local changes before publishing'
    Write-Ok 'Committed'
}

# --- Push -----------------------------------------------------------------

$branch = (git rev-parse --abbrev-ref HEAD).Trim()

if ($RemoteUrl) {
    Write-Step "Pushing to $RemoteUrl"
    if (git remote | Select-String -Quiet '^origin$') {
        git remote set-url origin $RemoteUrl
    } else {
        git remote add origin $RemoteUrl
    }
    git push -u origin $branch
    Write-Ok 'Pushed'
}
elseif (Get-Command gh -ErrorAction SilentlyContinue) {
    $visibility = if ($Public) { '--public' } else { '--private' }
    Write-Step "Creating $Name on GitHub ($($visibility.TrimStart('-')))"
    gh repo create $Name $visibility --source=. --remote=origin --push
    Write-Ok "Published — gh repo view $Name --web"
}
else {
    Write-Host ''
    Write-Warn 'The GitHub CLI is not installed, so the repo cannot be created automatically.'
    Write-Host ''
    Write-Host '  Either install it:   winget install --id GitHub.cli' -ForegroundColor Gray
    Write-Host '  then run this again.' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  Or create an empty repo at https://github.com/new' -ForegroundColor Gray
    Write-Host '  (no README, no .gitignore, no licence) and run:' -ForegroundColor Gray
    Write-Host ''
    Write-Host "     .\publish.ps1 -RemoteUrl https://github.com/<you>/$Name.git" -ForegroundColor White
    Write-Host ''
    exit 1
}

Write-Host ''
