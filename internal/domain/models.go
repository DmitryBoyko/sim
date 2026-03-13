package domain

import "time"

// DataPoint — одна точка оперативных данных (скорость, вес, фаза).
type DataPoint struct {
	T      time.Time `json:"t"`
	Speed  float64   `json:"speed"`
	Weight float64   `json:"weight"`
	Phase  string    `json:"phase"`
}

// Phase names
const (
	PhaseLoad      = "load"
	PhaseTransport = "transport"
	PhaseUnload    = "unload"
	PhaseReturn    = "return"
)

// PhasesConfig — длительности фаз и задержки в секундах.
type PhasesConfig struct {
	LoadDurationSec      int     `json:"load_duration_sec" mapstructure:"load_duration_sec"`
	TransportDurationSec int     `json:"transport_duration_sec" mapstructure:"transport_duration_sec"`
	UnloadDurationSec    int     `json:"unload_duration_sec" mapstructure:"unload_duration_sec"`
	ReturnDurationSec    int     `json:"return_duration_sec" mapstructure:"return_duration_sec"`
	// Задержка после разгрузки (техоперации/ожидание в зоне), сек.
	DelayAfterUnloadSec int `json:"delay_after_unload_sec" mapstructure:"delay_after_unload_sec"`
	// Задержка перед погрузкой, сек.
	DelayBeforeLoadSec int `json:"delay_before_load_sec" mapstructure:"delay_before_load_sec"`
	// Процент отклонения длительности фаз (Погрузка, Перевозка, Разгрузка, Возврат): для каждой фазы берётся % от значения и случайно прибавляется/вычитается. Одно значение на все фазы.
	PhaseDurationDeviationPercent float64 `json:"phase_duration_deviation_percent" mapstructure:"phase_duration_deviation_percent"`
}

// SpeedWeightConfig — пределы скорости и веса.
type SpeedWeightConfig struct {
	VMinKmh   float64 `json:"v_min_kmh" mapstructure:"v_min_kmh"`
	VMaxKmh   float64 `json:"v_max_kmh" mapstructure:"v_max_kmh"`
	MMaxTon   float64 `json:"m_max_ton" mapstructure:"m_max_ton"`
	MMinTon   float64 `json:"m_min_ton" mapstructure:"m_min_ton"`
	MEmptyTon float64 `json:"m_empty_ton" mapstructure:"m_empty_ton"`
}

// NoiseConfig — шумы для скорости и веса.
type NoiseConfig struct {
	SpeedNoiseKmh     float64 `json:"speed_noise_kmh" mapstructure:"speed_noise_kmh"`
	WeightNoiseTon   float64 `json:"weight_noise_ton" mapstructure:"weight_noise_ton"`
	WeightNoiseLoadTon float64 `json:"weight_noise_load_ton" mapstructure:"weight_noise_load_ton"` // шум веса при погрузке (амортизаторы)
}

// IntervalsConfig — интервал генерации и окно графика.
type IntervalsConfig struct {
	GenerationIntervalSec int `json:"generation_interval_sec" mapstructure:"generation_interval_sec"`
	ChartMinutes         int `json:"chart_minutes" mapstructure:"chart_minutes"`
}

// RecognitionConfig — параметры распознавания.
type RecognitionConfig struct {
	MatchThresholdPercent float64 `json:"match_threshold_percent" mapstructure:"match_threshold_percent"`
	Enabled               bool    `json:"enabled" mapstructure:"enabled"`
	// CooldownAfterTripSec — период охлаждения в секундах после найденного рейса; новый рейс не может начаться раньше конца предыдущего + cooldown. 0 = без охлаждения.
	CooldownAfterTripSec int `json:"cooldown_after_trip_sec" mapstructure:"cooldown_after_trip_sec"`
	// SpeedBaselineKmh — макс. скорость (км/ч), при которой считаем «конец/начало рейса» у оси. 0 = не проверять.
	SpeedBaselineKmh float64 `json:"speed_baseline_kmh" mapstructure:"speed_baseline_kmh"`
	// WeightBaselineTon — макс. вес (т), при котором считаем «порожний» у оси. 0 = не проверять.
	WeightBaselineTon float64 `json:"weight_baseline_ton" mapstructure:"weight_baseline_ton"`
	// UseZNormalization — true: Z-нормализация (форма сигнала); false: Min-Max вектор (по умолчанию).
	UseZNormalization bool `json:"use_z_normalization" mapstructure:"use_z_normalization"`
}

// AnalysisConfig — параметры анализа фаз рейса и веса груза (Plateau Detection).
type AnalysisConfig struct {
	PlateauHalfWindow        int     `json:"plateau_half_window" mapstructure:"plateau_half_window"`
	PlateauNoiseToleranceTon float64 `json:"plateau_noise_tolerance_ton" mapstructure:"plateau_noise_tolerance_ton"`
	PayloadThresholdTon     float64 `json:"payload_threshold_ton" mapstructure:"payload_threshold_ton"`
	MinPhasePoints          int     `json:"min_phase_points" mapstructure:"min_phase_points"`
	PlateauEdgeDilationEnabled bool `json:"plateau_edge_dilation_enabled" mapstructure:"plateau_edge_dilation_enabled"`
	PlateauGapClosingEnabled   bool `json:"plateau_gap_closing_enabled" mapstructure:"plateau_gap_closing_enabled"`
	PlateauMaxGapPoints        int  `json:"plateau_max_gap_points" mapstructure:"plateau_max_gap_points"`
}

// AppSettings — все настройки приложения.
type AppSettings struct {
	Phases      PhasesConfig      `json:"phases"`
	SpeedWeight SpeedWeightConfig `json:"speed_weight"`
	Noise       NoiseConfig       `json:"noise"`
	Intervals   IntervalsConfig   `json:"intervals"`
	Recognition RecognitionConfig `json:"recognition"`
	Analysis    AnalysisConfig    `json:"analysis"`
}

// TripTemplate — шаблон рейса (без вектора).
type TripTemplate struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	CreatedAt   time.Time `json:"created_at"`
	IntervalStart *time.Time `json:"interval_start,omitempty"`
	IntervalEnd   *time.Time `json:"interval_end,omitempty"`
	SpeedCount  int       `json:"speed_count"`
	WeightCount int       `json:"weight_count"`
	RawSpeed    []float64 `json:"raw_speed"`
	RawWeight   []float64 `json:"raw_weight"`
	RawTS       []time.Time `json:"raw_ts,omitempty"`
}

// TripTemplateWithVector — шаблон с вектором для сравнения.
type TripTemplateWithVector struct {
	TripTemplate
	Vector  []float64 `json:"vector"`
	ZVector []float64 `json:"zvector,omitempty"` // Z-нормализованный вектор (для режима use_z_normalization).
}

// DetectedTrip — найденный рейс.
type DetectedTrip struct {
	ID                    string        `json:"id"`
	StartedAt             time.Time     `json:"started_at"`
	EndedAt               time.Time     `json:"ended_at"`
	TemplateID            *string       `json:"template_id,omitempty"`
	TemplateName          string        `json:"template_name,omitempty"`
	MatchThresholdPercent *float64      `json:"match_threshold_percent,omitempty"`
	MatchPercent          float64       `json:"match_percent"`
	PayloadTon              *float64      `json:"payload_ton,omitempty"`
	TransportAvgWeightTon  *float64      `json:"transport_avg_weight_ton,omitempty"` // средний вес фазы «Транспортировка» (из trip_phases)
	Phases                 []PhaseSpan   `json:"-"`                // legacy, не в API
	AnalysisPhases         []TripPhase   `json:"phases,omitempty"`  // фазы анализа для API/WS
	CreatedAt              time.Time     `json:"created_at"`
}

// PhaseSpan — временной отрезок фазы (legacy).
type PhaseSpan struct {
	Phase string    `json:"phase"`
	From  time.Time `json:"from"`
	To    time.Time `json:"to"`
}

// TripPhase — фаза рейса по анализу (таблица trip_phases, API).
// phase_type: loading, transport, unloading, return.
type TripPhase struct {
	PhaseType   string    `json:"phase_type"`
	StartedAt   time.Time `json:"started_at"`
	EndedAt     time.Time `json:"ended_at"`
	DurationSec int       `json:"duration_sec"`
	AvgSpeedKmh  float64   `json:"avg_speed_kmh"`
	AvgWeightTon float64  `json:"avg_weight_ton"`
	PointCount  int       `json:"point_count"`
	SortOrder   int       `json:"sort_order"`
}
