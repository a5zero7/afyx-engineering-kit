package engine

type Config struct {
	WorkerCount int
}

func ExecuteTask(cfg Config) bool {
	return cfg.WorkerCount > 0
}

