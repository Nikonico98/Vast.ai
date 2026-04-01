"""
Imaginary World - GPU Pool Management
=======================================
Multi-GPU support for SAM3D parallel processing.

Each SAM3D job needs ~12GB GPU memory.
This module manages GPU allocation across multiple GPUs.

Usage:
    from gpu_pool import GPU_POOL, GPU_LOCK
    
    # Acquire a GPU
    gpu_id = GPU_POOL.acquire()
    # ... do work on gpu_id ...
    GPU_POOL.release(gpu_id)
    
    # Or use legacy lock
    with GPU_LOCK:
        # ... do work ...
"""

import subprocess
import threading
from queue import Queue, Empty
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


class GPUMode(Enum):
    SEQUENTIAL = "sequential"  # One job at a time (original behavior)
    PARALLEL = "parallel"      # Use multiple GPUs in parallel


@dataclass
class GPUInfo:
    """Information about a single GPU"""
    id: int
    name: str
    total_memory_mb: int
    free_memory_mb: int
    utilization: int  # percentage


class GPUPool:
    """
    Manages multiple GPUs for parallel SAM3D jobs.
    
    Features:
    - Automatic GPU detection on startup
    - Dynamic allocation of GPUs to jobs
    - Support for both sequential and parallel modes
    - Thread-safe resource management
    """
    
    def __init__(self):
        self._available_gpus = Queue()
        self._gpu_info: List[GPUInfo] = []
        self._lock = threading.Lock()
        self._mode = GPUMode.PARALLEL  # Default to parallel mode
        self._sequential_lock = threading.Lock()  # For sequential mode
        self._initialized = False
        
    def initialize(self):
        """Detect available GPUs and initialize the pool"""
        if self._initialized:
            return
            
        gpu_count = self._detect_gpus()
        
        with self._lock:
            # Clear and refill the queue
            while not self._available_gpus.empty():
                try:
                    self._available_gpus.get_nowait()
                except Empty:
                    break
            
            for i in range(gpu_count):
                self._available_gpus.put(i)
            
            self._initialized = True
            
        print(f"🖥️  GPU Pool initialized with {gpu_count} GPU(s)")
        for gpu in self._gpu_info:
            print(f"   GPU {gpu.id}: {gpu.name} ({gpu.total_memory_mb}MB)")
    
    def _detect_gpus(self) -> int:
        """Detect available NVIDIA GPUs using nvidia-smi"""
        self._gpu_info = []
        
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=index,name,memory.total,memory.free,utilization.gpu",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=10
            )
            
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    if line.strip():
                        parts = [p.strip() for p in line.split(',')]
                        if len(parts) >= 5:
                            gpu_info = GPUInfo(
                                id=int(parts[0]),
                                name=parts[1],
                                total_memory_mb=int(parts[2]),
                                free_memory_mb=int(parts[3]),
                                utilization=int(parts[4]) if parts[4].isdigit() else 0
                            )
                            self._gpu_info.append(gpu_info)
                
                return len(self._gpu_info)
        except Exception as e:
            print(f"⚠️  GPU detection failed: {e}")
        
        # Fallback: no GPU detected
        return 0
    
    def refresh_gpu_info(self) -> List[GPUInfo]:
        """Refresh GPU information (memory, utilization)"""
        self._detect_gpus()
        return self._gpu_info
    
    def get_gpu_count(self) -> int:
        """Get total number of available GPUs"""
        return len(self._gpu_info)
    
    def get_gpu_info(self) -> List[dict]:
        """Get GPU information as list of dicts"""
        self.refresh_gpu_info()
        return [
            {
                "id": gpu.id,
                "name": gpu.name,
                "total_memory_mb": gpu.total_memory_mb,
                "free_memory_mb": gpu.free_memory_mb,
                "utilization": gpu.utilization,
                "status": "busy" if gpu.utilization > 50 else "idle"
            }
            for gpu in self._gpu_info
        ]
    
    def get_mode(self) -> str:
        """Get current GPU mode"""
        return self._mode.value
    
    def set_mode(self, mode: str):
        """Set GPU mode (sequential or parallel)"""
        if mode == "sequential":
            self._mode = GPUMode.SEQUENTIAL
        else:
            self._mode = GPUMode.PARALLEL
        print(f"🔧 GPU mode set to: {self._mode.value}")
    
    def acquire(self, timeout: float = 300) -> Optional[int]:
        """
        Acquire a GPU for a job.
        
        In SEQUENTIAL mode: Uses lock, always returns GPU 0
        In PARALLEL mode: Returns next available GPU from pool
        
        Returns:
            GPU ID or None if timeout
        """
        if self._mode == GPUMode.SEQUENTIAL:
            # Sequential mode: use lock, always GPU 0
            acquired = self._sequential_lock.acquire(timeout=timeout)
            if acquired:
                return 0
            return None
        else:
            # Parallel mode: get from pool
            try:
                gpu_id = self._available_gpus.get(timeout=timeout)
                return gpu_id
            except Empty:
                return None
    
    def release(self, gpu_id: int):
        """Release a GPU back to the pool"""
        if self._mode == GPUMode.SEQUENTIAL:
            try:
                self._sequential_lock.release()
            except RuntimeError:
                pass  # Lock wasn't held
        else:
            self._available_gpus.put(gpu_id)
    
    def get_available_count(self) -> int:
        """Get number of currently available GPUs"""
        if self._mode == GPUMode.SEQUENTIAL:
            return 1 if not self._sequential_lock.locked() else 0
        else:
            return self._available_gpus.qsize()


# Global GPU Pool instance
GPU_POOL = GPUPool()


# Legacy GPU_LOCK for backward compatibility (now wraps GPU_POOL)
class LegacyGPULock:
    """Wrapper to maintain backward compatibility with GPU_LOCK usage"""
    def __enter__(self):
        self.gpu_id = GPU_POOL.acquire()
        return self.gpu_id
    
    def __exit__(self, *args):
        if self.gpu_id is not None:
            GPU_POOL.release(self.gpu_id)


GPU_LOCK = LegacyGPULock()
