@echo off
rem DeepSeek Harness dsh protocol-handler launcher, registered by
rem register-protocol.ps1.
rem
rem Input  dsh://session/SESSIONID
rem Output BASE/?session=SESSIONID, where BASE is resolved in this order:
rem   1. %DSH_SESSION_LINK_WEB_URL%   explicit override
rem   2. <state dir>\web-url          written by the plugin's host half
rem   3. http://127.0.0.1:3080        plain "dsh web" fallback
rem The state dir is %DSH_SESSION_LINK_STATE_DIR%, else
rem %LOCALAPPDATA%\dsh-session-link, else %TEMP%\dsh-session-link.
rem
rem The session marker rides on the index route: since dsh 0.1.1-rc.2 the Web
rem server answers unknown paths such as /s/SESSIONID with 404 - the SPA
rem fallback was removed - so only / and the configured index boot the app.
rem The web GUI must be running for the target session to open.
rem
rem Keep redirection and grouping characters out of this header: batch parses
rem them inside rem lines too.
setlocal
set "u=%~1"
if "%u%"=="" exit /b 0
if not "%u:~0,14%"=="dsh://session/" (
  >> "%TEMP%\dsh-open.log" echo %DATE% %TIME% ignored=%~1
  exit /b 0
)
set "id=%u:~14%"

rem --- resolve the web base URL --------------------------------------------
set "base="
set "source="
if defined DSH_SESSION_LINK_WEB_URL (
  set "base=%DSH_SESSION_LINK_WEB_URL%"
  set "source=env"
)
if not defined base call :read-state-file
if not defined base (
  set "base=http://127.0.0.1:3080"
  set "source=default"
)
if /i not "%base:~0,4%"=="http" (
  set "base=http://127.0.0.1:3080"
  set "source=default-invalid"
)
if "%base:~-1%"=="/" set "base=%base:~0,-1%"

>> "%TEMP%\dsh-open.log" echo %DATE% %TIME% raw=%~1 source=%source% target=%base%/?session=%id%
start "" "%base%/?session=%id%"
endlocal
exit /b 0

:read-state-file
set "dir=%DSH_SESSION_LINK_STATE_DIR%"
if not defined dir set "dir=%LOCALAPPDATA%\dsh-session-link"
if not defined LOCALAPPDATA set "dir=%TEMP%\dsh-session-link"
if not exist "%dir%\web-url" exit /b 0
rem `for /f` handles CRLF and LF-only files alike and takes the first line.
for /f "usebackq delims=" %%L in ("%dir%\web-url") do (
  if not defined base (
    set "base=%%L"
    set "source=file"
  )
)
exit /b 0
