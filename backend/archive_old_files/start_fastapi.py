#!/usr/bin/env python3
"""
FastAPI Startup Script for Fantasy Football Inflation Calculator
"""

import uvicorn
import os
import sys

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("🚀 Starting FastAPI Fantasy Football Inflation Calculator...")
    print("📊 API Documentation will be available at: http://localhost:5050/docs")
    print("🔍 Interactive API docs at: http://localhost:5050/redoc")
    print("🏥 Health check at: http://localhost:5050/health")
    print("\n" + "="*60)
    
    uvicorn.run(
        "fastapi_backend:app",
        host="0.0.0.0",
        port=5050,
        reload=True,
        log_level="info",
        access_log=True
    ) 