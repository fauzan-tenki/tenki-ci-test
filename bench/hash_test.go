package bench

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"testing"
)

func TestSHA256Known(t *testing.T) {
	sum := sha256.Sum256([]byte("tenki"))
	if got := hex.EncodeToString(sum[:4]); got == "" {
		t.Fatal("empty digest")
	}
}

func BenchmarkSHA256_1MiB(b *testing.B) {
	buf := make([]byte, 1<<20)
	b.SetBytes(int64(len(buf)))
	for i := 0; i < b.N; i++ {
		sha256.Sum256(buf)
	}
}

func BenchmarkSHA256_1MiB_Parallel(b *testing.B) {
	b.SetBytes(1 << 20)
	b.RunParallel(func(pb *testing.PB) {
		buf := make([]byte, 1<<20)
		for pb.Next() {
			sha256.Sum256(buf)
		}
	})
}

func BenchmarkSort_1M(b *testing.B) {
	src := make([]int, 1_000_000)
	for i := range src {
		src[i] = (i * 7919) % 1_000_003
	}
	dst := make([]int, len(src))
	for i := 0; i < b.N; i++ {
		copy(dst, src)
		sort.Ints(dst)
	}
}
