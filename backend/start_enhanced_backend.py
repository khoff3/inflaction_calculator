#!/usr/bin/env python3
"""
Enhanced FastAPI Startup Script for Fantasy Football Inflation Calculator
"""

import uvicorn
import os
import sys
import time
import psutil

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def print_system_info():
    """Print system information for performance monitoring."""
    print("🖥️  System Information:")
    print(f"   CPU Cores: {psutil.cpu_count()}")
    print(f"   Memory: {psutil.virtual_memory().total / (1024**3):.1f} GB")
    print(f"   Available Memory: {psutil.virtual_memory().available / (1024**3):.1f} GB")
    print()

def print_performance_tips():
    """Print performance optimization tips."""
    print("🚀 Performance Optimizations Enabled:")
    print("   ✅ In-memory caching with TTL")
    print("   ✅ Optimized lookup tables")
    print("   ✅ Async operations with thread pool")
    print("   ✅ Request cancellation support")
    print("   ✅ Memory-efficient data structures")
    print("   ✅ Parallel API calls")
    print()

if __name__ == "__main__":
    print("🚀 Starting Enhanced FastAPI Fantasy Football Inflation Calculator...")
    print("=" * 70)
    
    print_system_info()
    print_performance_tips()
    
    print("📊 API Endpoints:")
    print("   🏠 Root: http://localhost:5050/")
    print("   📊 API Docs: http://localhost:5050/docs")
    print("   🔍 Interactive Docs: http://localhost:5050/redoc")
    print("   🏥 Health Check: http://localhost:5050/health")
    print("   📈 Cache Stats: http://localhost:5050/cache/stats")
    print("   🗑️  Clear Cache: POST http://localhost:5050/cache/clear")
    print()
    
    print("⚡ Enhanced Features:")
    print("   • 5-minute cache TTL for inflation data")
    print("   • 30-second cache TTL for draft data")
    print("   • Optimized player lookups")
    print("   • Memory-efficient data structures")
    print("   • Real-time performance monitoring")
    print()
    
    print("=" * 70)
    print("Starting server...")
    
    uvicorn.run(
        "fastapi_backend_enhanced:app",
        host="0.0.0.0",
        port=5050,
        reload=True,
        log_level="info",
        access_log=True,
        workers=1  # Single worker for better caching
    ) 