package main

import "demo/go/engine"

func Start() bool {
	cfg := engine.Config{WorkerCount: 4}
	return engine.ExecuteTask(cfg)
}
