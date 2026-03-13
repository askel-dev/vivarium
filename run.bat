@echo off
echo Starting Vivarium Backend...
IF EXIST "venv\Scripts\activate.bat" (
    start cmd /k "venv\Scripts\activate && cd agent_world && python main_server.py"
) ELSE IF EXIST ".venv\Scripts\activate.bat" (
    start cmd /k ".venv\Scripts\activate && cd agent_world && python main_server.py"
) ELSE (
    start cmd /k "cd agent_world && python main_server.py"
)

echo Starting Vivarium Frontend...
start cmd /k "cd frontend && npm run dev"

echo.
echo ===================================================
echo Vivarium is starting in separate terminal windows.
echo Close those windows to stop the servers.
echo ===================================================
echo.