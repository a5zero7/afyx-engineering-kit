package worker

import "fmt"

type Job struct {
	ID int
}

func Process(job Job) string {
	return fmt.Sprint(job.ID)
}

var decoy = "func Ghost() {}"
// func Phantom() {}
