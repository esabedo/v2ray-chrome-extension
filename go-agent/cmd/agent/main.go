package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type profile struct {
	ID         string `json:"id"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Security   string `json:"security"`
	Network    string `json:"network"`
	Encryption string `json:"encryption"`
	SNI        string `json:"sni,omitempty"`
	FP         string `json:"fp,omitempty"`
	PBK        string `json:"pbk,omitempty"`
	SID        string `json:"sid,omitempty"`
	SPX        string `json:"spx,omitempty"`
	Flow       string `json:"flow,omitempty"`
	Remark     string `json:"remark,omitempty"`
	Raw        string `json:"raw"`
}

type profilePayload struct {
	VlessURL string `json:"vlessUrl"`
}

type agentState struct {
	mu sync.Mutex

	runtimeDir string
	profileFile string
	configFile string
	stdoutLog string
	stderrLog string

	singboxBin string
	httpProxyPort int
	socksProxyPort int
	startupTimeout time.Duration
	stopTimeout time.Duration

	cmd *exec.Cmd
	connected bool
	lastError string
}

func getenvInt(name string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return fallback
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil {
		return fallback
	}
	return n
}

func getenvDuration(name string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func newState() (*agentState, error) {
	root, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	runtimeDir := filepath.Join(root, "go-agent", "runtime")
	if err := os.MkdirAll(runtimeDir, 0o755); err != nil {
		return nil, err
	}
	return &agentState{
		runtimeDir: runtimeDir,
		profileFile: filepath.Join(runtimeDir, "profile.json"),
		configFile: filepath.Join(runtimeDir, "singbox-config.json"),
		stdoutLog: filepath.Join(runtimeDir, "singbox-stdout.log"),
		stderrLog: filepath.Join(runtimeDir, "singbox-stderr.log"),
		singboxBin: fallback(os.Getenv("SINGBOX_BIN"), filepath.Join(root, "agent", "bin", "sing-box")),
		httpProxyPort: getenvInt("HTTP_PROXY_PORT", 10809),
		socksProxyPort: getenvInt("SOCKS_PORT", 10808),
		startupTimeout: getenvDuration("CORE_STARTUP_TIMEOUT", 8*time.Second),
		stopTimeout: getenvDuration("CORE_STOP_TIMEOUT", 5*time.Second),
	}, nil
}

func fallback(v, d string) string {
	if strings.TrimSpace(v) == "" {
		return d
	}
	return v
}

func parseVLESS(raw string) (*profile, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "vless" {
		return nil, errors.New("unsupported scheme")
	}
	if u.User == nil {
		return nil, errors.New("missing id")
	}
	id := u.User.Username()
	if id == "" {
		return nil, errors.New("missing id")
	}
	host := u.Hostname()
	if host == "" {
		return nil, errors.New("missing host")
	}
	port := u.Port()
	if port == "" {
		return nil, errors.New("missing port")
	}
	var p int
	if _, err := fmt.Sscanf(port, "%d", &p); err != nil || p < 1 || p > 65535 {
		return nil, errors.New("invalid port")
	}
	q := u.Query()
	remark := strings.TrimPrefix(u.Fragment, "#")
	if decoded, err := url.QueryUnescape(remark); err == nil {
		remark = decoded
	}
	return &profile{
		ID: id,
		Host: host,
		Port: p,
		Security: fallback(q.Get("security"), "none"),
		Network: fallback(q.Get("type"), "tcp"),
		Encryption: fallback(q.Get("encryption"), "none"),
		SNI: q.Get("sni"),
		FP: q.Get("fp"),
		PBK: q.Get("pbk"),
		SID: q.Get("sid"),
		SPX: q.Get("spx"),
		Flow: q.Get("flow"),
		Remark: remark,
		Raw: raw,
	}, nil
}

func sanitizeProfile(p *profile) []string {
	issues := make([]string, 0)
	if p.Security != "reality" {
		return issues
	}
	if p.SNI == "" {
		issues = append(issues, "missing sni")
	}
	if p.FP == "" {
		issues = append(issues, "missing fp")
	}
	if p.SID == "" {
		issues = append(issues, "missing sid")
	} else {
		if len(p.SID) > 16 {
			issues = append(issues, "sid length > 16")
		}
		if _, err := hex.DecodeString(p.SID); err != nil {
			issues = append(issues, "sid is not hex")
		}
	}
	if p.PBK == "" {
		issues = append(issues, "missing pbk")
	} else {
		b, err := base64.RawURLEncoding.DecodeString(p.PBK)
		if err != nil || len(b) != 32 {
			issues = append(issues, "pbk should be base64url 32-byte key")
		}
	}
	return issues
}

func buildSingboxConfig(p *profile, httpPort, socksPort int) map[string]any {
	return map[string]any{
		"log": map[string]any{
			"level": "info",
		},
		"inbounds": []any{
			map[string]any{
				"type": "socks",
				"tag": "socks-in",
				"listen": "127.0.0.1",
				"listen_port": socksPort,
			},
			map[string]any{
				"type": "http",
				"tag": "http-in",
				"listen": "127.0.0.1",
				"listen_port": httpPort,
			},
		},
		"outbounds": []any{
			map[string]any{
				"type": "vless",
				"tag": "proxy",
				"server": p.Host,
				"server_port": p.Port,
				"uuid": p.ID,
				"flow": p.Flow,
				"packet_encoding": "xudp",
				"tls": map[string]any{
					"enabled": true,
					"server_name": p.SNI,
					"utls": map[string]any{
						"enabled": true,
						"fingerprint": fallback(p.FP, "chrome"),
					},
					"reality": map[string]any{
						"enabled": true,
						"public_key": p.PBK,
						"short_id": p.SID,
					},
				},
			},
			map[string]any{"type": "direct", "tag": "direct"},
			map[string]any{"type": "block", "tag": "block"},
		},
		"route": map[string]any{
			"final": "proxy",
			"auto_detect_interface": true,
		},
	}
}

func (s *agentState) saveProfile(p *profile) error {
	profileJSON, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.profileFile, profileJSON, 0o600); err != nil {
		return err
	}
	configJSON, err := json.MarshalIndent(buildSingboxConfig(p, s.httpProxyPort, s.socksProxyPort), "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.configFile, configJSON, 0o600)
}

func (s *agentState) loadProfile() (*profile, error) {
	raw, err := os.ReadFile(s.profileFile)
	if err != nil {
		return nil, err
	}
	var p profile
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *agentState) stopCoreLocked() {
	if s.cmd == nil || s.cmd.Process == nil {
		return
	}
	_ = s.cmd.Process.Signal(os.Interrupt)
	done := make(chan error, 1)
	go func() { done <- s.cmd.Wait() }()
	select {
	case <-time.After(s.stopTimeout):
		_ = s.cmd.Process.Kill()
		<-done
	case <-done:
	}
	s.cmd = nil
	s.connected = false
}

func (s *agentState) waitPort(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	target := fmt.Sprintf("127.0.0.1:%d", port)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", target, 350*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		time.Sleep(120 * time.Millisecond)
	}
	return fmt.Errorf("port %s not ready in %s", target, timeout)
}

func (s *agentState) startCoreLocked() error {
	if _, err := os.Stat(s.configFile); err != nil {
		return errors.New("missing generated sing-box config")
	}
	if _, err := os.Stat(s.singboxBin); err != nil {
		return fmt.Errorf("sing-box binary not found: %s", s.singboxBin)
	}
	_ = os.WriteFile(s.stdoutLog, []byte{}, 0o600)
	_ = os.WriteFile(s.stderrLog, []byte{}, 0o600)

	stdout, err := os.OpenFile(s.stdoutLog, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	defer stdout.Close()
	stderr, err := os.OpenFile(s.stderrLog, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	defer stderr.Close()

	cmd := exec.Command(s.singboxBin, "run", "-c", s.configFile)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	s.cmd = cmd

	time.Sleep(250 * time.Millisecond)
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		return fmt.Errorf("sing-box exited early with code %d", cmd.ProcessState.ExitCode())
	}
	if err := s.waitPort(s.httpProxyPort, s.startupTimeout); err != nil {
		s.stopCoreLocked()
		return err
	}
	s.connected = true
	s.lastError = ""
	return nil
}

func (s *agentState) tail(path string, lines int) []string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return []string{}
	}
	items := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	out := make([]string, 0, lines)
	for i := len(items)-1; i >=0 && len(out) < lines; i-- {
		if strings.TrimSpace(items[i]) == "" {
			continue
		}
		out = append(out, items[i])
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func main() {
	state, err := newState()
	if err != nil {
		log.Fatalf("failed to init agent: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/v1/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("/v1/profile", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"detail": "method not allowed"})
			return
		}
		var payload profilePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"detail": "invalid request payload"})
			return
		}
		p, err := parseVLESS(payload.VlessURL)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"detail": err.Error()})
			return
		}
		state.mu.Lock()
		defer state.mu.Unlock()
		if err := state.saveProfile(p); err != nil {
			state.lastError = err.Error()
			writeJSON(w, http.StatusInternalServerError, map[string]any{"detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("/v1/connect", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"detail": "method not allowed"})
			return
		}
		state.mu.Lock()
		defer state.mu.Unlock()
		_, err := state.loadProfile()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"detail": "no profile saved"})
			return
		}
		state.stopCoreLocked()
		if err := state.startCoreLocked(); err != nil {
			state.lastError = err.Error()
			writeJSON(w, http.StatusInternalServerError, map[string]any{"detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"connected": true,
			"httpProxyPort": state.httpProxyPort,
		})
	})

	mux.HandleFunc("/v1/disconnect", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"detail": "method not allowed"})
			return
		}
		state.mu.Lock()
		defer state.mu.Unlock()
		state.stopCoreLocked()
		writeJSON(w, http.StatusOK, map[string]any{"connected": false})
	})

	mux.HandleFunc("/v1/status", func(w http.ResponseWriter, _ *http.Request) {
		state.mu.Lock()
		defer state.mu.Unlock()
		alive := state.cmd != nil && state.cmd.ProcessState == nil
		if state.connected && !alive {
			state.connected = false
			if state.lastError == "" {
				state.lastError = "sing-box process is not running"
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"connected": state.connected,
			"httpProxyPort": state.httpProxyPort,
			"lastError": nullIfEmpty(state.lastError),
		})
	})

	mux.HandleFunc("/v1/diagnostics", func(w http.ResponseWriter, _ *http.Request) {
		state.mu.Lock()
		defer state.mu.Unlock()
		profileExists := fileExists(state.profileFile)
		configExists := fileExists(state.configFile)
		ver := "unknown"
		if out, err := exec.Command(state.singboxBin, "version").CombinedOutput(); err == nil {
			line := strings.Split(strings.TrimSpace(string(out)), "\n")
			if len(line) > 0 {
				ver = line[0]
			}
		} else {
			ver = fmt.Sprintf("error: %v", err)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"mockMode": false,
			"agentCore": "singbox",
			"xrayBin": "",
			"singboxBin": state.singboxBin,
			"xrayVersion": ver,
			"httpProxyPort": state.httpProxyPort,
			"socksProxyPort": state.socksProxyPort,
			"profileExists": profileExists,
			"configExists": false,
			"singboxConfigExists": configExists,
			"connected": state.connected,
			"lastError": nullIfEmpty(state.lastError),
			"xrayStderrTail": state.tail(state.stderrLog, 10),
		})
	})

	mux.HandleFunc("/v1/profile/debug", func(w http.ResponseWriter, _ *http.Request) {
		state.mu.Lock()
		defer state.mu.Unlock()
		p, err := state.loadProfile()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"detail": "no profile saved"})
			return
		}
		issues := sanitizeProfile(p)
		pbkHash := hash16(p.PBK)
		sidHash := hash16(p.SID)
		writeJSON(w, http.StatusOK, map[string]any{
			"endpoint": fmt.Sprintf("%s:%d", p.Host, p.Port),
			"security": p.Security,
			"network": p.Network,
			"flow": p.Flow,
			"sni": p.SNI,
			"fp": p.FP,
			"sidMasked": mask(p.SID),
			"sidHash": sidHash,
			"spx": p.SPX,
			"pbkMasked": mask(p.PBK),
			"pbkHash": pbkHash,
			"issues": issues,
		})
	})

	mux.HandleFunc("/v1/xray/logs", func(w http.ResponseWriter, _ *http.Request) {
		state.mu.Lock()
		defer state.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"core": "singbox",
			"stdout": state.tail(state.stdoutLog, 80),
			"stderr": state.tail(state.stderrLog, 80),
		})
	})

	server := &http.Server{
		Addr: ":8777",
		Handler: mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-context.Background().Done()
	}()

	log.Printf("go-agent listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server failed: %v", err)
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func hash16(v string) string {
	if strings.TrimSpace(v) == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:])[:16]
}

func mask(v string) string {
	if len(v) <= 8 {
		return strings.Repeat("*", len(v))
	}
	return v[:4] + "..." + v[len(v)-4:]
}

func nullIfEmpty(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}
