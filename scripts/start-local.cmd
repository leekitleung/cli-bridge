@echo off
REM RP-2.19 operator convenience: double-click entry for the configured local
REM launcher. It only sets the default config path (when unset) and starts the
REM existing `npm run start:local-server:configured`. No other logic.

cd /d "%~dp0.."

if "%CLI_BRIDGE_LOCAL_CONFIG%"=="" set "CLI_BRIDGE_LOCAL_CONFIG=scripts\local-config.json"

call npm run start:local-server:configured

REM Keep the window open if launched by double-click so the URL/token stay visible.
pause
