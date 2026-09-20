@echo off
rem DeepSeek Harness dsh protocol-handler launcher, registered by
rem register-protocol.ps1.
rem
rem Input  dsh://session/SESSIONID
rem Output http://127.0.0.1:3080/?session=SESSIONID
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
>> "%TEMP%\dsh-open.log" echo %DATE% %TIME% raw=%~1 target=http://127.0.0.1:3080/?session=%id%
start "" "http://127.0.0.1:3080/?session=%id%"
endlocal
