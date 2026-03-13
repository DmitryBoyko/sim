package vector

import "math"

const varianceEpsilon = 1e-12 // защита от деления на ноль (постоянный сигнал)

// ZNormalize returns z-scores: mean=0, std=1 over the given slice.
// Formula (classic fixed-window Z-normalization): μ = (1/N)Σx_i, σ = sqrt((1/N)Σx_i² - μ²), z_i = (x_i - μ)/σ.
// If variance is zero (constant signal), returns zeros. See e.g. Sukhanov et al. "Real Time Pattern Matching with Dynamic Normalization", Signal Processing 2020 — we use the standard (non-dynamic) variant here.
// ZNormalize возвращает z-оценки: среднее=0, σ=1 по переданному срезу.
func ZNormalize(values []float64) []float64 {
	n := float64(len(values))
	if n == 0 {
		return nil
	}
	var sum, sumSq float64
	for _, v := range values {
		sum += v
		sumSq += v * v
	}
	mean := sum / n
	variance := sumSq/n - mean*mean
	if variance < varianceEpsilon {
		return make([]float64, len(values))
	}
	std := math.Sqrt(variance)
	result := make([]float64, len(values))
	for i, v := range values {
		result[i] = (v - mean) / std
	}
	return result
}

// BuildVectorZ builds a single vector: concat(ZNormalize(speeds), ZNormalize(weights)).
func BuildVectorZ(speeds, weights []float64) []float64 {
	zs := ZNormalize(speeds)
	zw := ZNormalize(weights)
	out := make([]float64, 0, len(zs)+len(zw))
	out = append(out, zs...)
	out = append(out, zw...)
	return out
}

// NormalizePercent scales values in slice to 0..100 by min/max of the slice.
// If all same or empty, returns slice of zeros (or same value 50).
func NormalizePercent(values []float64) []float64 {
	if len(values) == 0 {
		return nil
	}
	minV, maxV := values[0], values[0]
	for _, v := range values[1:] {
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	out := make([]float64, len(values))
	span := maxV - minV
	if span == 0 {
		for i := range out {
			out[i] = 50
		}
		return out
	}
	for i, v := range values {
		out[i] = (v - minV) / span * 100
	}
	return out
}

// BuildVectorFromSeries builds a single vector: concat(normalize(speeds), normalize(weights)).
func BuildVectorFromSeries(speeds, weights []float64) []float64 {
	ns := NormalizePercent(speeds)
	nw := NormalizePercent(weights)
	out := make([]float64, 0, len(ns)+len(nw))
	out = append(out, ns...)
	out = append(out, nw...)
	return out
}

// MatchPercent returns similarity in 0..100 (100 = identical).
// Uses 1 - normalized L1 distance (normalized by vector length and max possible diff).
// So: sum(|a[i]-b[i]|) / (len * 100) = avg diff in percent scale; similarity = (1 - avg/100) * 100.
func MatchPercent(a, b []float64) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	var sum float64
	for i := range a {
		diff := a[i] - b[i]
		if diff < 0 {
			diff = -diff
		}
		sum += diff
	}
	avg := sum / float64(len(a))
	// avg is in 0..100 scale
	similarity := 100 - avg
	if similarity < 0 {
		similarity = 0
	}
	return similarity
}

// CosineSimilarity returns value in [-1, 1]. Can be converted to percent: (cos+1)/2*100.
func CosineSimilarity(a, b []float64) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

// CosineSimilarityPercent returns similarity in 0..100 from cosine in [-1,1]: (cos+1)/2*100.
func CosineSimilarityPercent(a, b []float64) float64 {
	cos := CosineSimilarity(a, b)
	pct := (cos + 1) / 2 * 100
	if pct < 0 {
		return 0
	}
	if pct > 100 {
		return 100
	}
	return pct
}
