// OTP Verification V4 — port of the Pixelvault_io "Micro UI #3/10"
// single-file web design to React Native. Tokens are exact from the
// source: violet accent #7b6cff, mint #2dd4a0 success, red #ff5d66
// error, 6 glass digit boxes + a hexagon cube stage around a glowing
// core cube, joined by animated dashed lines.
//
// What was SIMPLIFIED for mobile (the web is a 5:4 desktop frame):
// - No starfield, grid floor, floating tiles, shooting star, dust
//   motes, cursor spotlight, pointer parallax, or card tilt — phones
//   have no cursor. The space scene is aurora blobs + dark
//   background only (ScreenBackground already provides the orbs).
// - No rotating specular rim on the card (no conic gradients in RN)
//   and no hover states; GlassCard supplies the liquid-glass surface.
// - No SMS autofill pill: the SMS goes to the GUARDIAN's phone, not
//   this device, so an auto-fill would be fake. Paste still works.
// - No "Replay" link: verification is one-way; success moves on.
// - Cube hover-flip dropped (no hover on touch).
//
// HARD RULE: the verdict comes ONLY from the server (POST
// /guardians/:id/verify via utils/guardian.ts). Nothing in this file
// compares digits locally, and the demo's correct code never appears.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Reanimated, {
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  Line,
  Path,
  Polygon,
  RadialGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { Theme } from '@/constants/theme';

const ACCENT = '#7b6cff';
const OK = '#2dd4a0';
const ERR = '#ff5d66';
const N = 6;
const RESEND_SECS = 30;
const STAGE_H = 210;
const CUBE = 46;
const CORE = 62;
const ANGLES = [-150, -90, -30, 30, 90, 150];

export type OtpPhase = 'idle' | 'verifying' | 'error' | 'success';

interface OtpCubesProps {
  phone: string;
  phase: OtpPhase;
  errorMessage?: string | null;
  busy: boolean;
  resetNonce: number;
  onCodeComplete: (code: string) => void;
  onResend: () => void;
  onReset: () => void;
}

const AnimatedLine = Reanimated.createAnimatedComponent(Line);
const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);
const AnimatedPath = Reanimated.createAnimatedComponent(Path);

// Isometric glass cube: top + left + right faces, digit on the front
// (right) face. The core cube gets violet faces + a light dot instead
// of a digit, and red/mint faces on error/success.
function IsoCube({
  size,
  digit,
  core,
  verdict,
  focused,
  lit,
  uid,
}: {
  size: number;
  digit: string;
  core?: boolean;
  verdict?: 'ok' | 'err' | null;
  focused?: boolean;
  lit?: boolean;
  uid: string;
}) {
  const fs = Math.round(size * 0.42);
  const top = core
    ? verdict === 'err'
      ? '#ff7d85'
      : verdict === 'ok'
        ? '#3ee6b2'
        : '#8c80ff'
    : 'rgba(255,255,255,0.16)';
  const left = core
    ? verdict === 'err'
      ? '#d63a47'
      : verdict === 'ok'
        ? '#12a574'
        : '#5340ee'
    : 'rgba(255,255,255,0.035)';
  const right = core
    ? verdict === 'err'
      ? '#e85460'
      : verdict === 'ok'
        ? '#1fbf8a'
        : '#6a5cff'
    : 'rgba(255,255,255,0.09)';
  const stroke = core
    ? 'rgba(255,255,255,0.55)'
    : focused
      ? ACCENT
      : lit
        ? 'rgba(255,255,255,0.9)'
        : 'rgba(255,255,255,0.2)';
  const coreGlow = verdict === 'err' ? ERR : verdict === 'ok' ? OK : ACCENT;
  return (
    <Svg width={size} height={size * 1.1} viewBox="0 0 60 66">
      <Defs>
        <RadialGradient id={`cg-${uid}`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={coreGlow} stopOpacity="0.55" />
          <Stop offset="1" stopColor={coreGlow} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {(focused || core) && <Ellipse cx="30" cy="36" rx="30" ry="30" fill={`url(#cg-${uid})`} />}
      <Polygon points="30,3 57,18 30,33 3,18" fill={top} stroke={stroke} strokeWidth="1" />
      <Polygon points="3,18 30,33 30,63 3,48" fill={left} stroke={stroke} strokeWidth="1" />
      <Polygon points="30,33 57,18 57,48 30,63" fill={right} stroke={stroke} strokeWidth="1" />
      {core ? (
        <Circle cx="43" cy="42" r="3" fill="#ffffff" opacity="0.95" />
      ) : (
        <SvgText
          x="43"
          y="52"
          fontSize={fs}
          fontWeight="700"
          fill={lit ? '#c8c2ff' : '#ffffff'}
          textAnchor="middle"
        >
          {digit}
        </SvgText>
      )}
    </Svg>
  );
}

// One digit cube on its hexagon slot: bob + spin while scrambling,
// then an orbit that spirals into the core and shrinks away.
function OrbitCube({
  x0,
  y0,
  r0,
  a0,
  orbit,
  spin,
  bob,
  children,
}: {
  x0: number;
  y0: number;
  r0: number;
  a0: number;
  orbit: SharedValue<number>;
  spin: SharedValue<number>;
  bob: SharedValue<number>;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const e = orbit.value;
    const ee = e * e * (3 - 2 * e);
    const a = a0 + Math.PI * 3 * ee;
    const r = r0 * (1 - 0.94 * ee);
    return {
      opacity: e < 0.8 ? 1 : 1 - (e - 0.8) / 0.2,
      transform: [
        { translateX: r * Math.cos(a) - x0 },
        { translateY: r * Math.sin(a) - y0 + bob.value * -7 },
        { rotate: `${spin.value}deg` },
        { scale: 1 - 0.75 * ee },
      ],
    };
  });
  return <Reanimated.View style={[styles.cubeSlot, style]}>{children}</Reanimated.View>;
}

// One shockwave ring on success: expands and fades once.
function ShockRing({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: 0.8 * (1 - progress.value),
    transform: [{ scale: 0.6 + 2.8 * progress.value }],
  }));
  return <Reanimated.View style={[styles.shockRing, style]} pointerEvents="none" />;
}

// One burst particle: flies out from the core and fades.
function Particle({
  angle,
  dist,
  size,
  square,
  green,
  rot,
  progress,
}: {
  angle: number;
  dist: number;
  size: number;
  square: boolean;
  green: boolean;
  rot: number;
  progress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: 1 - p,
      transform: [
        { translateX: Math.cos(angle) * dist * p },
        { translateY: Math.sin(angle) * dist * p + 30 * p },
        { scale: 1 - 0.8 * p },
        { rotate: `${rot * p}deg` },
      ],
    };
  });
  return (
    <Reanimated.View
      style={[
        styles.particle,
        { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, backgroundColor: green ? OK : ACCENT, borderRadius: square ? 3 : size / 2 },
        style,
      ]}
      pointerEvents="none"
    />
  );
}

// One glass digit box: digit pops in on entry; focused lifts + glows.
function DigitBox({
  index,
  digit,
  focused,
  phase,
  editable,
  inputRef,
  onChange,
  onKeyPress,
  onFocus,
  onBlur,
}: {
  index: number;
  digit: string;
  focused: boolean;
  phase: OtpPhase;
  editable: boolean;
  inputRef: (el: TextInput | null) => void;
  onChange: (index: number, text: string) => void;
  onKeyPress: (index: number, key: string) => void;
  onFocus: (index: number) => void;
  onBlur: (index: number) => void;
}) {
  const pop = useSharedValue(1);
  useEffect(() => {
    if (digit) {
      pop.value = 0.6;
      pop.value = withSpring(1, { damping: 10, stiffness: 300 });
    }
  }, [digit]);
  const popStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }, { translateY: focused ? -4 : 0 }],
  }));
  return (
    <Reanimated.View style={popStyle}>
      <TextInput
        ref={inputRef}
        style={[
          styles.box,
          focused && styles.boxFocused,
          phase === 'error' && styles.boxError,
          phase === 'success' && styles.boxOk,
        ]}
        value={digit}
        onChangeText={(t) => onChange(index, t)}
        onKeyPress={({ nativeEvent }) => onKeyPress(index, nativeEvent.key)}
        onFocus={() => onFocus(index)}
        onBlur={() => onBlur(index)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        editable={editable}
        selectTextOnFocus
        accessibilityLabel={`Digit ${index + 1}`}
      />
    </Reanimated.View>
  );
}

export default function OtpCubes({
  phone,
  phase,
  errorMessage,
  busy,
  resetNonce,
  onCodeComplete,
  onResend,
  onReset,
}: OtpCubesProps) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [focused, setFocused] = useState(-1);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECS);
  const [scramble, setScramble] = useState<string[] | null>(null);
  const [verdict, setVerdict] = useState<'ok' | 'err' | null>(null);
  const [burst, setBurst] = useState(false);
  const [burstNonce, setBurstNonce] = useState(0);
  const [stageW, setStageW] = useState(320);

  const inputRefs = useRef<(TextInput | null)[]>([]);
  const submittedRef = useRef(false);
  const lockedRef = useRef(false);
  const verdictRef = useRef<'ok' | 'err' | null>(null);
  const introDoneRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scrambleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const orbit = useSharedValue(0);
  const spin = useSharedValue(0);
  const bob = useSharedValue(0);
  const shakeX = useSharedValue(0);
  const dash = useSharedValue(0);
  const drift = useSharedValue(0);
  const coreScale = useSharedValue(1);
  const coreOpacity = useSharedValue(1);
  const coreRotate = useSharedValue(0);
  const ringC = useSharedValue(0);
  const ringK = useSharedValue(0);
  const xDraw1 = useSharedValue(0);
  const xDraw2 = useSharedValue(0);
  const shock1 = useSharedValue(0);
  const shock2 = useSharedValue(0);
  const shock3 = useSharedValue(0);
  const burstProgress = useSharedValue(0);
  const greenGlow = useSharedValue(0);
  const successText = useSharedValue(0);
  const markOpacity = useSharedValue(0);

  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (scrambleRef.current) {
      clearInterval(scrambleRef.current);
      scrambleRef.current = null;
    }
  };

  useEffect(() => {
    bob.value = withRepeat(withTiming(1, { duration: 2250, easing: Easing.inOut(Easing.ease) }), -1, true);
    dash.value = withRepeat(withTiming(-18, { duration: 1200, easing: Easing.linear }), -1);
    drift.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.ease) }), -1, true);
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 350);
    return () => {
      clearTimers();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resend countdown: 30s from mount / resend, ticks only while idle.
  useEffect(() => {
    if (phase !== 'idle') return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Parent-driven reset (after a failed verdict, or a dead network).
  useEffect(() => {
    resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  const resetAll = () => {
    clearTimers();
    setDigits(['', '', '', '', '', '']);
    setScramble(null);
    setVerdict(null);
    setBurst(false);
    setSecondsLeft(RESEND_SECS);
    setFocused(-1);
    inputRefs.current[0]?.focus();
    submittedRef.current = false;
    lockedRef.current = false;
    verdictRef.current = null;
    introDoneRef.current = false;
    orbit.value = 0;
    spin.value = 0;
    shakeX.value = 0;
    coreScale.value = 1;
    coreOpacity.value = 1;
    coreRotate.value = 0;
    ringC.value = 0;
    ringK.value = 0;
    xDraw1.value = 0;
    xDraw2.value = 0;
    shock1.value = 0;
    shock2.value = 0;
    shock3.value = 0;
    burstProgress.value = 0;
    greenGlow.value = 0;
    successText.value = 0;
    markOpacity.value = 0;
  };

  const focusBox = (i: number) => {
    const idx = Math.max(0, Math.min(N - 1, i));
    setFocused(idx);
    inputRefs.current[idx]?.focus();
  };

  const complete = (code: string) => {
    if (submittedRef.current || code.length !== N) return;
    submittedRef.current = true;
    lockedRef.current = true;
    onCodeComplete(code);
  };

  // Paste of a full code drops the digits in one by one, like the
  // web autofill — but only from the clipboard, never a fake SMS.
  const fillSequentially = (code: string) => {
    lockedRef.current = true;
    setDigits(['', '', '', '', '', '']);
    for (let k = 0; k < N; k++) {
      later(() => {
        setDigits((prev) => {
          const next = [...prev];
          next[k] = code[k];
          return next;
        });
      }, 90 * (k + 1));
    }
    later(() => {
      lockedRef.current = false;
      complete(code);
    }, 90 * N + 200);
  };

  const handleBoxChange = (i: number, text: string) => {
    if (lockedRef.current || phase !== 'idle') return;
    const clean = text.replace(/\D/g, '');
    if (clean.length > 1) {
      const pasted = clean.slice(0, N);
      if (pasted.length === N) {
        fillSequentially(pasted);
        return;
      }
      const next = [...digits];
      for (let k = 0; k < pasted.length && i + k < N; k++) next[i + k] = pasted[k];
      setDigits(next);
      if (next.every(Boolean)) {
        complete(next.join(''));
        return;
      }
      focusBox(Math.min(i + pasted.length, N - 1));
      return;
    }
    const next = [...digits];
    next[i] = clean.slice(-1);
    setDigits(next);
    if (clean) {
      // Completion fires whenever the last empty box fills, not
      // only when the 6th digit lands in the last box (out-of-order
      // entry would otherwise never verify).
      if (next.every(Boolean)) {
        complete(next.join(''));
        return;
      }
      if (i < N - 1) focusBox(i + 1);
    }
  };

  const handleKeyPress = (i: number, key: string) => {
    if (lockedRef.current || phase !== 'idle') return;
    if (key === 'Backspace') {
      const next = [...digits];
      if (next[i]) {
        next[i] = '';
        setDigits(next);
      } else if (i > 0) {
        next[i - 1] = '';
        setDigits(next);
        focusBox(i - 1);
      }
    } else if (key === 'ArrowLeft') {
      focusBox(i - 1);
    } else if (key === 'ArrowRight') {
      focusBox(i + 1);
    } else if (key === 'Delete') {
      const next = [...digits];
      next[i] = '';
      setDigits(next);
    }
  };

  const handleResend = () => {
    if (secondsLeft > 0 || busy || phase !== 'idle') return;
    resetAll();
    onResend();
  };

  // --- verification choreography: scramble -> spin -> orbit ->
  // converge, then the verdict (which waits for the SERVER response,
  // never a local digit comparison).
  const startVerification = () => {
    scrambleRef.current = setInterval(() => {
      setScramble(Array.from({ length: N }, () => String(Math.floor(Math.random() * 10))));
    }, 70);
    spin.value = withTiming(1080, { duration: 2400, easing: Easing.inOut(Easing.ease) });
    later(() => {
      orbit.value = withTiming(1, { duration: 1400, easing: Easing.linear });
    }, 1000);
    later(() => {
      introDoneRef.current = true;
      maybeApplyVerdict();
    }, 2400);
  };

  const maybeApplyVerdict = () => {
    if (!introDoneRef.current || !verdictRef.current) return;
    if (verdictRef.current === 'err') runErrorVerdict();
    else runSuccessVerdict();
    verdictRef.current = null;
  };

  const runErrorVerdict = () => {
    if (scrambleRef.current) {
      clearInterval(scrambleRef.current);
      scrambleRef.current = null;
    }
    setScramble(null);
    setVerdict('err');
    shakeX.value = withSequence(
      withTiming(-2, { duration: 50 }),
      withTiming(4, { duration: 50 }),
      withTiming(-9, { duration: 50 }),
      withTiming(9, { duration: 50 }),
      withTiming(-9, { duration: 50 }),
      withTiming(9, { duration: 50 }),
      withTiming(-2, { duration: 50 }),
      withTiming(0, { duration: 50 })
    );
    xDraw1.value = withDelay(250, withTiming(1, {duration: 350}));
    xDraw2.value = withDelay(400, withTiming(1, {duration: 350}));
    later(() => {
      orbit.value = withSpring(0, { damping: 14, stiffness: 130 });
      spin.value = 0;
    }, 1000);
    later(() => onReset(), 1850);
  };

  const runSuccessVerdict = () => {
    if (scrambleRef.current) {
      clearInterval(scrambleRef.current);
      scrambleRef.current = null;
    }
    setScramble(null);
    setVerdict('ok');
    coreScale.value = withDelay(500, withTiming(0.15, { duration: 650, easing: Easing.bezier(0.6, 0, 0.3, 1) }));
    coreOpacity.value = withDelay(500, withTiming(0, {duration: 650}));
    coreRotate.value = withDelay(500, withTiming(120, {duration: 650}));
    shock1.value = withDelay(500, withTiming(1, {duration: 1100}));
    shock2.value = withDelay(720, withTiming(1, {duration: 1100}));
    shock3.value = withDelay(940, withTiming(1, {duration: 1100}));
    ringC.value = withDelay(600, withTiming(1, {duration: 700}));
    ringK.value = withDelay(1200, withTiming(1, {duration: 450}));
    markOpacity.value = withDelay(550, withTiming(1, {duration: 200}));
    greenGlow.value = withTiming(1, { duration: 1200 });
    successText.value = withDelay(1500, withTiming(1, {duration: 600}));
    later(() => {
      setBurst(true);
      setBurstNonce((n) => n + 1);
      burstProgress.value = withTiming(1, { duration: 1400 });
    }, 950);
  };

  useEffect(() => {
    if (phase === 'verifying') startVerification();
    else if (phase === 'error') {
      verdictRef.current = 'err';
      maybeApplyVerdict();
    } else if (phase === 'success') {
      verdictRef.current = 'ok';
      maybeApplyVerdict();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const particles = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        angle: (i / 24) * Math.PI * 2 + Math.random() * 0.3,
        dist: 70 + Math.random() * 60,
        size: i % 3 === 0 ? 9 : 7,
        square: i % 3 === 0,
        green: i % 2 === 1,
        rot: Math.random() * 540 - 270,
      })),
    [burstNonce]
  );

  const stageH = STAGE_H;
  const cx = stageW / 2;
  const cy = stageH / 2;
  const cubeSlot = (i: number) => {
    const a = (ANGLES[i] * Math.PI) / 180;
    return {
      x: cx + 0.37 * stageW * Math.cos(a),
      y: cy + 0.36 * stageH * Math.sin(a),
      x0: 0.37 * stageW * Math.cos(a),
      y0: 0.36 * stageH * Math.sin(a),
      r0: Math.hypot(0.37 * stageW * Math.cos(a), 0.36 * stageH * Math.sin(a)),
      a0: a,
    };
  };

  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: dash.value }));
  const circleProps = useAnimatedProps(() => ({ strokeDashoffset: 252 * (1 - ringC.value) }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: 80 * (1 - ringK.value) }));
  const x1Props = useAnimatedProps(() => ({ strokeDashoffset: 60 * (1 - xDraw1.value) }));
  const x2Props = useAnimatedProps(() => ({ strokeDashoffset: 60 * (1 - xDraw2.value) }));

  const stageShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));
  const driftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value * 20 }, { translateY: drift.value * 12 }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    opacity: coreOpacity.value,
    transform: [{ scale: coreScale.value }, { rotate: `${coreRotate.value}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: greenGlow.value * 0.5 }));
  const successTextStyle = useAnimatedStyle(() => ({ opacity: successText.value }));
  const markStyle = useAnimatedStyle(() => ({ opacity: markOpacity.value }));

  const lineStroke = phase === 'verifying' ? ACCENT : verdict === 'err' ? ERR : 'rgba(255,255,255,0.35)';
  const ringFraction = secondsLeft / RESEND_SECS;

  return (
    <View>
      {/* Cube stage: aurora blobs, dashed lines, hexagon cubes, core,
          verdict mark, shockwaves, particles, success glow. */}
      <View
        style={styles.stageWrap}
        onLayout={(e) => setStageW(Math.max(280, e.nativeEvent.layout.width))}
      >
        <Reanimated.View style={[StyleSheet.absoluteFillObject, driftStyle]} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="blobV" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={ACCENT} stopOpacity="0.5" />
                <Stop offset="1" stopColor={ACCENT} stopOpacity="0" />
              </RadialGradient>
              <RadialGradient id="blobB" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#38bdf8" stopOpacity="0.35" />
                <Stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Ellipse cx={stageW * 0.3} cy={stageH * 0.25} rx="110" ry="90" fill="url(#blobV)" />
            <Ellipse cx={stageW * 0.75} cy={stageH * 0.8} rx="100" ry="80" fill="url(#blobB)" />
          </Svg>
        </Reanimated.View>

        <Reanimated.View style={[styles.stage, stageShakeStyle]}>
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
            <Defs>
              <RadialGradient id="okGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={OK} stopOpacity="0.5" />
                <Stop offset="1" stopColor={OK} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            {Array.from({ length: N }, (_, i) => {
              const p = cubeSlot(i);
              return (
                <AnimatedLine
                  key={i}
                  x1={cx}
                  y1={cy}
                  x2={p.x}
                  y2={p.y}
                  stroke={lineStroke}
                  strokeWidth="1"
                  strokeDasharray="3 6"
                  animatedProps={lineProps}
                />
              );
            })}
          </Svg>

          {Array.from({ length: N }, (_, i) => {
            const p = cubeSlot(i);
            return (
              <View key={i} style={[styles.cubeSlotPos, { left: p.x - CUBE / 2, top: p.y - (CUBE * 1.1) / 2 }]}>
                <OrbitCube x0={p.x0} y0={p.y0} r0={p.r0} a0={p.a0} orbit={orbit} spin={spin} bob={bob}>
                  <IsoCube
                    size={CUBE}
                    digit={scramble ? scramble[i] : digits[i]}
                    focused={focused === i && phase === 'idle'}
                    lit={!!digits[i]}
                    uid={`d${i}`}
                  />
                </OrbitCube>
              </View>
            );
          })}

          <View style={[styles.coreSlot, { left: cx - CORE / 2, top: cy - (CORE * 1.1) / 2 }]}>
            <Reanimated.View style={coreStyle}>
              <IsoCube size={CORE} digit="" core verdict={verdict} uid="core" />
            </Reanimated.View>
          </View>

          <Reanimated.View style={[styles.glow, glowStyle]} pointerEvents="none">
            <Svg width="100%" height="100%">
              <Defs>
                <RadialGradient id="successGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={OK} stopOpacity="0.55" />
                  <Stop offset="1" stopColor={OK} stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Ellipse cx={cx} cy={cy} rx={stageW * 0.45} ry={stageH * 0.5} fill="url(#successGlow)" />
            </Svg>
          </Reanimated.View>

          {verdict === 'ok' && (
            <Reanimated.View style={[styles.mark, markStyle]} pointerEvents="none">
              <Svg width="118" height="118" viewBox="0 0 100 100">
                <AnimatedCircle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={OK}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="252"
                  animatedProps={circleProps}
                  transform="rotate(-90 50 50)"
                />
                <AnimatedPath
                  d="M30 52l14 14 27-30"
                  fill="none"
                  stroke={OK}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="80"
                  animatedProps={checkProps}
                />
              </Svg>
            </Reanimated.View>
          )}

          {verdict === 'err' && (
            <View style={styles.markX} pointerEvents="none">
              <Svg width="64" height="64" viewBox="0 0 64 64">
                <AnimatedPath
                  d="M20 20l24 24"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="60"
                  animatedProps={x1Props}
                />
                <AnimatedPath
                  d="M44 20L20 44"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="60"
                  animatedProps={x2Props}
                />
              </Svg>
            </View>
          )}

          {verdict === 'ok' && (
            <>
              <View style={styles.center} pointerEvents="none">
                <ShockRing progress={shock1} />
              </View>
              <View style={styles.center} pointerEvents="none">
                <ShockRing progress={shock2} />
              </View>
              <View style={styles.center} pointerEvents="none">
                <ShockRing progress={shock3} />
              </View>
              {burst &&
                particles.map((p, i) => (
                  <View key={i} style={styles.center} pointerEvents="none">
                    <Particle
                      angle={p.angle}
                      dist={p.dist}
                      size={p.size}
                      square={p.square}
                      green={p.green}
                      rot={p.rot}
                      progress={burstProgress}
                    />
                  </View>
                ))}
            </>
          )}
        </Reanimated.View>
      </View>

      {/* Digit boxes */}
      <Reanimated.View style={[styles.row, stageShakeStyle]}>
        {digits.map((d, i) => (
          <DigitBox
            key={i}
            index={i}
            digit={d}
            focused={focused === i}
            phase={phase}
            editable={phase === 'idle' && !busy}
            inputRef={(el) => {
              inputRefs.current[i] = el;
            }}
            onChange={handleBoxChange}
            onKeyPress={handleKeyPress}
            onFocus={(idx) => setFocused(idx)}
            onBlur={() => setFocused(-1)}
          />
        ))}
      </Reanimated.View>

      {/* Message line */}
      <View style={styles.msgWrap}>
        {phase === 'verifying' ? (
          <Text style={[styles.msg, styles.msgInfo]}>Verifying…</Text>
        ) : phase === 'error' ? (
          <Text style={[styles.msg, styles.msgErr]}>{errorMessage || 'That code isn’t right. Please try again.'}</Text>
        ) : phase === 'success' ? (
          <Reanimated.View style={successTextStyle}>
            <Text style={[styles.msg, styles.msgBig]}>Verified. You’re all set.</Text>
          </Reanimated.View>
        ) : (
          <Text style={[styles.msg, styles.msgInfo]}>Enter the 6-digit code sent to {phone}.</Text>
        )}
      </View>

      {/* Resend: countdown, then a link that re-requests the code. */}
      {phase === 'idle' && (
        <View style={styles.resend}>
          <Text style={styles.resendText}>Didn’t receive the code?</Text>
          {secondsLeft > 0 ? (
            <View style={styles.timerRow}>
              <Svg width="22" height="22" viewBox="0 0 22 22" style={{ transform: [{ rotate: '-90deg' }] }}>
                <Circle cx="11" cy="11" r="10" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2.5" />
                <Circle
                  cx="11"
                  cy="11"
                  r="10"
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray="62.8"
                  strokeDashoffset={62.8 * (1 - ringFraction)}
                />
              </Svg>
              <Text style={styles.timer}>Resend in {secondsLeft}s</Text>
            </View>
          ) : (
            <Pressable onPress={handleResend} disabled={busy} accessibilityRole="button">
              <Text style={styles.link}>Resend code</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stageWrap: {
    position: 'relative',
    height: STAGE_H,
    marginTop: 8,
    marginBottom: 4,
  },
  stage: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  cubeSlot: {
    position: 'absolute',
  },
  cubeSlotPos: {
    position: 'absolute',
  },
  coreSlot: {
    position: 'absolute',
    zIndex: 2,
  },
  glow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  mark: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -59,
    marginTop: -59,
    width: 118,
    height: 118,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  markX: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -32,
    marginTop: -32,
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  center: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 6,
  },
  shockRing: {
    position: 'absolute',
    width: 90,
    height: 90,
    marginLeft: -45,
    marginTop: -45,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: OK,
  },
  particle: {
    position: 'absolute',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  box: {
    flex: 1,
    height: 52,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '600',
    color: '#ffffff',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 13,
  },
  boxFocused: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(123,108,255,0.12)',
    shadowColor: ACCENT,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  boxError: {
    borderColor: ERR,
    color: ERR,
    backgroundColor: 'rgba(255,93,102,0.10)',
  },
  boxOk: {
    borderColor: OK,
    color: OK,
  },
  msgWrap: {
    minHeight: 20,
    marginTop: 14,
    alignItems: 'center',
  },
  msg: {
    fontFamily: Theme.fonts.body,
    fontSize: 13,
    textAlign: 'center',
  },
  msgInfo: {
    color: Theme.colors.onSurfaceVariant,
  },
  msgErr: {
    color: ERR,
  },
  msgBig: {
    fontSize: 17,
    fontWeight: '700',
    color: OK,
  },
  resend: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    minHeight: 30,
  },
  resendText: {
    fontFamily: Theme.fonts.body,
    fontSize: 14,
    color: Theme.colors.onSurfaceVariant,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timer: {
    fontFamily: Theme.fonts.bodyBold,
    fontSize: 14,
    color: Theme.colors.onSurface,
    fontVariant: ['tabular-nums'],
  },
  link: {
    fontFamily: Theme.fonts.bodyBold,
    fontSize: 14,
    color: '#a99fff',
  },
});
