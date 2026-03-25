import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import logoUrl from "../logo.png";

const API_URL = "https://router.huggingface.co/v1/chat/completions";
const HF_TOKEN = import.meta.env.VITE_HF_TOKEN;
const HF_MODEL = "meta-llama/Meta-Llama-3-8B-Instruct";
const XP_PER_STEP = 50;
const XP_PER_QUESTION = 10;

const mockSteps = [
  {
    title: "Define your goal",
    detail: "Clarify what success looks like and set a short-term objective."
  },
  {
    title: "Build fundamentals",
    detail: "Focus on the essential concepts before moving to advanced topics."
  },
  {
    title: "Practice with feedback",
    detail: "Apply what you learn and collect quick feedback to improve."
  },
  {
    title: "Create a mini project",
    detail: "Use your knowledge in a small, realistic project."
  },
  {
    title: "Reflect and level up",
    detail: "Review progress and decide the next challenge to tackle."
  }
];

const badgeList = [
  { id: "starter", label: "Starter", threshold: 1 },
  { id: "builder", label: "Builder", threshold: 3 },
  { id: "finisher", label: "Finisher", threshold: 5 }
];

const loadingPhrases = [
  "Helping you learn",
  "Mapping your learning path",
  "Gathering the best next steps",
  "Preparing your quest"
];

function normalizeSteps(payload) {
  if (!payload) return [];
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    const fencedMatch = trimmed.match(/```(?:json)?\n([\s\S]*?)```/i);
    const maybeJson = fencedMatch ? fencedMatch[1].trim() : trimmed;

    const tryParse = (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    let parsed = tryParse(maybeJson);
    if (!parsed) {
      const arrayMatch = maybeJson.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        parsed = tryParse(arrayMatch[0]);
      }
    }

    if (parsed) return normalizeSteps(parsed);

    const lines = maybeJson
      .split("\n")
      .map((line) => line.replace(/^\s*[-*\d.]+\s*/, "").trim())
      .filter(
        (line) =>
          line &&
          !["[", "]", "{", "}", "```", "json"].includes(line.toLowerCase()) &&
          !line.startsWith("\"") &&
          !line.endsWith("\":")
      );
    if (lines.length) {
      return lines.map((line) => ({ title: line, detail: "" }));
    }
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.map((item, index) => {
      if (typeof item === "string") {
        return { title: item, detail: "" };
      }
      if (typeof item === "object" && item !== null) {
        return {
          title: item.title || item.step || `Step ${index + 1}`,
          detail: item.detail || item.description || ""
        };
      }
      return { title: `Step ${index + 1}`, detail: "" };
    });
  }
  if (payload.steps && Array.isArray(payload.steps)) {
    return normalizeSteps(payload.steps);
  }
  if (payload.choices && Array.isArray(payload.choices)) {
    const content = payload.choices[0]?.message?.content;
    if (content) return normalizeSteps(content);
  }
  return [];
}

function extractJsonObject(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\n([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  const tryParse = (raw) => {
    if (!raw) return null;
    const cleaned = raw.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  const findBalancedJson = (textBlock) => {
    const startIdx = textBlock.search(/[\[{]/);
    if (startIdx === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < textBlock.length; i += 1) {
      const char = textBlock[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{" || char === "[") depth += 1;
      if (char === "}" || char === "]") depth -= 1;
      if (depth === 0 && i > startIdx) {
        return textBlock.slice(startIdx, i + 1);
      }
    }
    return null;
  };

  const balanced = findBalancedJson(candidate);
  return tryParse(balanced);
}

function stripHtmlTags(value) {
  if (typeof value !== "string") return value;
  return value.replace(/<[^>]*>/g, "");
}

function sanitizeUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return "";
}

function getLevel(xp) {
  return Math.floor(xp / 200) + 1;
}

const renderMarkdown = (text) => {
  const html = marked.parse(text || "", { breaks: true });
  return { __html: DOMPurify.sanitize(html) };
};

function App() {
  const [topic, setTopic] = useState("");
  const [steps, setSteps] = useState([]);
  const [completed, setCompleted] = useState(() => new Set());
  const [view, setView] = useState("landing");
  const [loading, setLoading] = useState(false);
  const [usedMock, setUsedMock] = useState(false);
  const [apiError, setApiError] = useState("");
  const [celebrate, setCelebrate] = useState(null);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [openStep, setOpenStep] = useState(null);
  const [lessonsByStep, setLessonsByStep] = useState({});
  const [lessonLoading, setLessonLoading] = useState({});
  const [lessonError, setLessonError] = useState({});
  const [slideIndexByStep, setSlideIndexByStep] = useState({});
  const [quizAnswersByStep, setQuizAnswersByStep] = useState({});
  const [qaInput, setQaInput] = useState("");
  const [qaHistory, setQaHistory] = useState([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState("");

  useEffect(() => {
    if (!loading) return;
    const interval = window.setInterval(() => {
      setLoadingIndex((prev) => (prev + 1) % loadingPhrases.length);
    }, 1400);
    return () => window.clearInterval(interval);
  }, [loading]);

  const totalSteps = steps.length || 1;
  const completedCount = completed.size;
  const progress = Math.round((completedCount / totalSteps) * 100);
  const totalCorrect = Object.entries(quizAnswersByStep).reduce((sum, [stepIdx, answers]) => {
    const lesson = lessonsByStep[stepIdx];
    if (!lesson?.practice?.length) return sum;
    return (
      sum +
      lesson.practice.reduce((acc, item, qIdx) => {
        const selected = answers?.[qIdx];
        const correct = item?.answer;
        return acc + (Number.isInteger(selected) && selected === correct ? 1 : 0);
      }, 0)
    );
  }, 0);

  const xp = completedCount * XP_PER_STEP + totalCorrect * XP_PER_QUESTION;
  const level = getLevel(xp);

  const unlockedBadges = useMemo(() => {
    return badgeList.map((badge) => ({
      ...badge,
      unlocked: completedCount >= badge.threshold
    }));
  }, [completedCount]);

  const toggleStep = (index) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
        triggerFeedback(index);
      }
      return next;
    });
  };

  const toggleOpenStep = (index) => {
    setOpenStep((prev) => (prev === index ? null : index));
  };

  const fetchLesson = async (index) => {
    if (!steps[index]) return;
    if (lessonsByStep[index]) return;

    setLessonLoading((prev) => ({ ...prev, [index]: true }));
    setLessonError((prev) => ({ ...prev, [index]: "" }));

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {})
        },
        body: JSON.stringify({
          model: HF_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are Learnr, an expert tutor. Return ONLY valid JSON with this exact shape: {\"slides\":[{\"title\":\"\",\"info\":\"\",\"example\":\"\"},{\"title\":\"\",\"info\":\"\",\"example\":\"\"},{\"title\":\"\",\"info\":\"\",\"example\":\"\"}],\"practice\":[{\"question\":\"\",\"options\":[\"A\",\"B\",\"C\",\"D\"],\"answer\":0},{\"question\":\"\",\"options\":[\"A\",\"B\",\"C\",\"D\"],\"answer\":0},{\"question\":\"\",\"options\":[\"A\",\"B\",\"C\",\"D\"],\"answer\":0}],\"resources\":[{\"title\":\"\",\"url\":\"\",\"why\":\"\"},{\"title\":\"\",\"url\":\"\",\"why\":\"\"}]}. 'answer' is the index of the correct option (0-3). Keep slides concise and practical. Use plain text URLs (no HTML)."
            },
            {
              role: "user",
              content: `Topic: ${topic || "General learning"}. Step: ${steps[index].title}. Detail: ${steps[index].detail || ""}. Provide 3 slides (info + example), exactly 3 multiple-choice practice questions with 4 options each, and 2 recommended resources with URLs.`
            }
          ],
          temperature: 0.5
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Lesson request failed (${response.status}): ${detail}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      let lessonPayload = content || data;
      if (typeof lessonPayload === "string") {
        const parsed = extractJsonObject(lessonPayload);
        lessonPayload =
          parsed || {
            slides: [{ title: steps[index].title, info: "Lesson format error. Try again.", example: "" }],
            practice: []
          };
      }

      const slides = Array.isArray(lessonPayload.slides) ? lessonPayload.slides : [];
      const practice = Array.isArray(lessonPayload.practice)
        ? lessonPayload.practice
        : Array.isArray(lessonPayload.practice_questions)
        ? lessonPayload.practice_questions
        : [];
      const resources = Array.isArray(lessonPayload.resources) ? lessonPayload.resources : [];

      const sanitizedSlides = slides.map((slide) => ({
        title: stripHtmlTags(slide.title || ""),
        info: stripHtmlTags(slide.info || ""),
        example: stripHtmlTags(slide.example || "")
      }));
      const sanitizedPractice = practice.map((item) => ({
        question: stripHtmlTags(item.question || ""),
        options: Array.isArray(item.options)
          ? item.options.map((option) => stripHtmlTags(option))
          : [],
        answer: item.answer
      }));
      const sanitizedResources = resources.map((item) => ({
        title: stripHtmlTags(item.title || ""),
        url: sanitizeUrl(item.url || ""),
        why: stripHtmlTags(item.why || "")
      }));

      setLessonsByStep((prev) => ({
        ...prev,
        [index]: {
          slides: sanitizedSlides.length
            ? sanitizedSlides
            : [{ title: steps[index].title, info: "Lesson ready.", example: "" }],
          practice: sanitizedPractice,
          resources: sanitizedResources
        }
      }));
      setSlideIndexByStep((prev) => ({ ...prev, [index]: 0 }));
      setQuizAnswersByStep((prev) => ({ ...prev, [index]: {} }));
    } catch (error) {
      setLessonError((prev) => ({
        ...prev,
        [index]: error instanceof Error ? error.message : "Unknown lesson error"
      }));
    } finally {
      setLessonLoading((prev) => ({ ...prev, [index]: false }));
    }
  };

  const triggerFeedback = (index) => {
    setCelebrate(index);
    window.setTimeout(() => setCelebrate(null), 600);

    if (typeof window !== "undefined" && window.AudioContext) {
      const ctx = new window.AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      osc.onended = () => ctx.close();
    }
  };

  const handleOptionSelect = (stepIndex, questionIndex, optionIndex) => {
    setQuizAnswersByStep((prev) => ({
      ...prev,
      [stepIndex]: {
        ...(prev[stepIndex] || {}),
        [questionIndex]: optionIndex
      }
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!topic.trim()) return;

    setLoading(true);
    setUsedMock(false);
    setApiError("");
    setCompleted(new Set());
    setOpenStep(null);
    setLessonsByStep({});
    setLessonLoading({});
    setLessonError({});
    setSlideIndexByStep({});
    setQuizAnswersByStep({});
    setQaHistory([]);
    setQaInput("");
    setQaError("");
    setLoadingIndex(0);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {})
        },
        body: JSON.stringify({
          model: HF_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are Learnr, an expert tutor. Return ONLY valid JSON: an array of step objects with 'title' and optional 'detail'. Provide 5-7 concise steps."
            },
            {
              role: "user",
              content: `Create a learning path for: ${topic}`
            }
          ],
          temperature: 0.4
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`API request failed (${response.status}): ${detail}`);
      }

      const data = await response.json();
      const normalized = normalizeSteps(data);
      if (!normalized.length) {
        throw new Error("No steps returned");
      }
      setSteps(normalized);
      setView("dashboard");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unknown API error");
      const topicLabel = topic.trim() || "your goal";
      setSteps(
        mockSteps.map((step, index) => ({
          ...step,
          title: index === 0 ? `Define ${topicLabel}` : step.title
        }))
      );
      setUsedMock(true);
      setView("dashboard");
    } finally {
      setLoading(false);
    }
  };

  const handleAskQuestion = async (event) => {
    event.preventDefault();
    if (!qaInput.trim() || qaLoading) return;

    const question = qaInput.trim();
    setQaLoading(true);
    setQaError("");
    setQaInput("");

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {})
        },
        body: JSON.stringify({
          model: HF_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are Learnr, a friendly expert tutor. Format responses for clean UI: 1 short paragraph, then 3-5 bullet points. If you include code, keep it under 8 lines and wrap it in triple backticks with a language tag. Avoid long dumps or multiple code blocks."
            },
            {
              role: "user",
              content: `Topic: ${topic || "General learning"}. Question: ${question}`
            }
          ],
          temperature: 0.5
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Q&A request failed (${response.status}): ${detail}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("Empty response from AI");

      setQaHistory((prev) => [
        { role: "user", text: question },
        { role: "ai", text: content },
        ...prev
      ]);
    } catch (error) {
      setQaError(error instanceof Error ? error.message : "Unknown Q&A error");
    } finally {
      setQaLoading(false);
    }
  };

  return (
    <div className="min-h-screen text-softWhite">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/90 px-6 backdrop-blur">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-soft">
            <div className="mx-auto mb-6 h-12 w-12 animate-spin rounded-full border-4 border-gold border-t-transparent" />
            <p className="text-sm uppercase tracking-[0.3em] text-gold/70">Learnr</p>
            <h2 className="mt-3 font-display text-2xl font-semibold">
              {loadingPhrases[loadingIndex]}
            </h2>
            <p className="mt-2 text-sm text-white/60">Building your step-by-step guide...</p>
            <button
              type="button"
              onClick={() => {
                setLoading(false);
                setView("landing");
              }}
              className="mt-6 rounded-full border border-white/20 px-5 py-2 text-sm text-white/70 transition hover:border-gold hover:text-gold"
            >
              Back to topic
            </button>
          </div>
        </div>
      )}
      <div className="px-6 py-8">
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-white/5 shadow-soft">
              <img src={logoUrl} alt="Learnr logo" className="h-full w-full object-cover" />
              <div className="pointer-events-none absolute inset-0 ring-1 ring-white/10" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-gold/70">Learnr</p>
              <h1 className="font-display text-3xl font-semibold md:text-4xl">Learn anything, step by step.</h1>
            </div>
          </div>
          {view === "dashboard" && (
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-4 shadow-soft">
              <div className="flex items-center justify-between text-sm text-white/70">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="progress-stripe h-full rounded-full bg-gradient-to-r from-gold to-goldBright transition-all duration-700 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </header>

        {view === "landing" && (
          <section className="mx-auto mt-20 flex max-w-3xl flex-col items-center gap-8 text-center">
            <div className="space-y-4">
              <h2 className="font-display text-4xl font-semibold md:text-5xl">Your AI learning quest starts here.</h2>
              <p className="text-base text-white/70 md:text-lg">
                Tell us what you want to learn and we will craft a focused path with progress, XP, and rewards.
              </p>
            </div>
            <form
              onSubmit={handleSubmit}
              className="glow-ring flex w-full flex-col items-stretch gap-4 rounded-full border border-white/10 bg-white/5 p-2 md:flex-row"
            >
              <input
                type="text"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="What do you want to learn?"
                className="flex-1 rounded-full bg-transparent px-6 py-4 text-lg text-white placeholder:text-white/40 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-full bg-gold px-8 py-4 font-semibold text-night shadow-glow transition hover:-translate-y-0.5 hover:bg-goldBright"
              >
                Start Learning
              </button>
            </form>
          </section>
        )}

        {view === "dashboard" && (
          <section className="mt-12 grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-soft">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.2em] text-white/60">Current Quest</p>
                    <h2 className="font-display text-2xl font-semibold">{topic || "Your new skill"}</h2>
                  </div>
                  <button
                    onClick={() => setView("landing")}
                    className="rounded-full border border-gold/60 px-4 py-2 text-sm text-gold transition hover:bg-gold hover:text-night"
                  >
                    New Topic
                  </button>
                </div>
                {usedMock && (
                  <div className="space-y-2 text-sm text-white/50">
                    <p>Using fallback steps while the AI endpoint is warming up.</p>
                    {apiError && (
                      <p className="text-xs text-white/40">
                        Debug: {apiError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-8 space-y-4">
                {steps.map((step, index) => {
                  const done = completed.has(index);
                  const isOpen = openStep === index;
                  const lesson = lessonsByStep[index];
                  const lessonIsLoading = lessonLoading[index];
                  const lessonErr = lessonError[index];
                  const slideIndex = slideIndexByStep[index] ?? 0;
                  const quizAnswers = quizAnswersByStep[index] || {};
                  return (
                    <div
                      key={step.title + index}
                      className={`step-card flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 p-5 ${
                        done ? "border-gold/60 bg-gradient-to-r from-white/10 to-white/5" : ""
                      } ${celebrate === index ? "animate-pop" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <h3 className="font-display text-xl font-semibold">
                            {index + 1}. {step.title}
                          </h3>
                          {step.detail && <p className="text-sm text-white/70">{step.detail}</p>}
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => {
                              toggleOpenStep(index);
                              if (!lessonsByStep[index]) fetchLesson(index);
                            }}
                            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/70 transition hover:border-gold hover:text-gold"
                          >
                            {isOpen ? "Hide Lesson" : "Open Lesson"}
                          </button>
                          <button
                            onClick={() => toggleStep(index)}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                              done
                                ? "border-gold bg-gold text-night"
                                : "border-white/20 text-white/70 hover:border-gold hover:text-gold"
                            }`}
                          >
                            {done ? "Completed" : "Mark Complete"}
                          </button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
                          {lessonIsLoading && (
                            <div className="flex items-center gap-3">
                              <span className="h-3 w-3 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                              Loading lesson...
                            </div>
                          )}
                          {!lessonIsLoading && lessonErr && (
                            <p className="text-xs text-white/50">Debug: {lessonErr}</p>
                          )}
                          {!lessonIsLoading && lesson && (
                            <div className="space-y-5">
                              <div className="flex items-center justify-between text-xs text-white/50">
                                <span>Lesson Slides</span>
                                <span>
                                  {Math.min(slideIndex + 1, lesson.slides.length)} /{" "}
                                  {lesson.slides.length}
                                </span>
                              </div>

                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="font-display text-base font-semibold">
                                  {lesson.slides[slideIndex]?.title || "Slide"}
                                </p>
                                <p className="mt-2 text-sm text-white/80">
                                  {lesson.slides[slideIndex]?.info || "Lesson details loading."}
                                </p>
                                {lesson.slides[slideIndex]?.example && (
                                  <div className="mt-3 rounded-xl border border-gold/20 bg-gold/10 p-3 text-xs text-white/80">
                                    <span className="text-gold/80">Example:</span>{" "}
                                    {lesson.slides[slideIndex]?.example}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSlideIndexByStep((prev) => ({
                                      ...prev,
                                      [index]: Math.max(0, slideIndex - 1)
                                    }))
                                  }
                                  disabled={slideIndex === 0}
                                  className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 transition hover:border-gold hover:text-gold disabled:opacity-40"
                                >
                                  Previous
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSlideIndexByStep((prev) => ({
                                      ...prev,
                                      [index]: Math.min(
                                        lesson.slides.length - 1,
                                        slideIndex + 1
                                      )
                                    }))
                                  }
                                  disabled={slideIndex >= lesson.slides.length - 1}
                                  className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 transition hover:border-gold hover:text-gold disabled:opacity-40"
                                >
                                  Next
                                </button>
                              </div>

                              {lesson.practice?.length > 0 && (
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-gold/70">
                                    Practice Questions
                                  </p>
                                  <p className="mt-2 text-xs text-white/50">
                                    Score:{" "}
                                    {lesson.practice.reduce((acc, item, qIdx) => {
                                      const selected = quizAnswers[qIdx];
                                      const correct = item?.answer;
                                      return acc + (selected === correct ? 1 : 0);
                                    }, 0)}
                                    /{lesson.practice.length}
                                  </p>
                                  <div className="mt-3 space-y-4 text-white/70">
                                    {lesson.practice.map((item, idx) => (
                                      <div key={`${index}-pr-${idx}`} className="space-y-2">
                                        <p className="text-sm font-semibold">
                                          {idx + 1}. {item.question || item}
                                        </p>
                                        <div className="grid gap-2 md:grid-cols-2">
                                          {(item.options || []).map((option, optIdx) => {
                                            const selected = quizAnswers[idx] === optIdx;
                                            const isCorrect = item?.answer === optIdx;
                                            const showState = Number.isInteger(quizAnswers[idx]);
                                            const stateClass = showState
                                              ? selected && isCorrect
                                                ? "border-gold bg-gold/20 text-gold"
                                                : selected && !isCorrect
                                                ? "border-red-400/60 bg-red-500/10 text-red-200"
                                                : isCorrect
                                                ? "border-gold/40 text-gold/70"
                                                : "border-white/10"
                                              : "border-white/10";
                                            return (
                                              <button
                                                key={`${index}-pr-${idx}-opt-${optIdx}`}
                                                type="button"
                                                onClick={() => handleOptionSelect(index, idx, optIdx)}
                                                className={`rounded-xl border bg-white/5 px-3 py-2 text-left text-xs text-white/70 transition hover:border-gold hover:text-gold ${stateClass}`}
                                              >
                                                <span className="flex items-center justify-between gap-2">
                                                  <span>{option}</span>
                                                  {showState && selected && (
                                                    <span
                                                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                        isCorrect
                                                          ? "bg-gold/20 text-gold"
                                                          : "bg-red-500/20 text-red-200"
                                                      }`}
                                                    >
                                                      {isCorrect ? "OK" : "X"}
                                                    </span>
                                                  )}
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {lesson.resources?.length > 0 && (
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-gold/70">
                                    Recommended Resources
                                  </p>
                                  <div className="mt-3 space-y-3 text-white/70">
                                    {lesson.resources.map((resource, idx) => (
                                      <div
                                        key={`${index}-rs-${idx}`}
                                        className="rounded-xl border border-white/10 bg-white/5 p-3"
                                      >
                                        <p className="text-sm font-semibold">
                                          {resource.title || "Resource"}
                                        </p>
                                        {resource.why && (
                                          <p className="mt-1 text-xs text-white/60">
                                            {resource.why}
                                          </p>
                                        )}
                                        {resource.url && (
                                          <a
                                            href={resource.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-2 inline-block text-xs text-gold/80 underline decoration-gold/50 underline-offset-4 transition hover:text-gold"
                                          >
                                            {resource.url}
                                          </a>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-xs text-white/50">
                        <span className={`h-2 w-2 rounded-full ${done ? "bg-gold" : "bg-white/20"}`} />
                        {done ? "XP earned" : "Complete to earn XP"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-soft">
                <h3 className="font-display text-xl font-semibold">Ask Learnr</h3>
                <p className="mt-2 text-sm text-white/70">
                  Ask anything about your current topic and get a focused answer.
                </p>
                <form onSubmit={handleAskQuestion} className="mt-4 space-y-3">
                  <input
                    type="text"
                    value={qaInput}
                    onChange={(event) => setQaInput(event.target.value)}
                    placeholder="Ask a question..."
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="w-full rounded-full bg-gold px-4 py-2 text-sm font-semibold text-night shadow-glow transition hover:-translate-y-0.5 hover:bg-goldBright disabled:opacity-50"
                    disabled={qaLoading}
                  >
                    {qaLoading ? "Thinking..." : "Ask Learnr"}
                  </button>
                </form>
                {qaError && <p className="mt-3 text-xs text-white/50">Debug: {qaError}</p>}
                <div className="mt-4 max-h-56 space-y-3 overflow-auto pr-1">
                  {qaHistory.length === 0 && (
                    <p className="text-xs text-white/50">No questions yet.</p>
                  )}
                  {qaHistory.map((item, idx) => (
                    <div
                      key={`qa-${idx}`}
                      className={`rounded-2xl border px-3 py-2 text-xs ${
                        item.role === "user"
                          ? "border-white/10 bg-white/5 text-white/70"
                          : "border-gold/40 bg-gold/10 text-white/80"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                        {item.role === "user" ? "You" : "Learnr"}
                      </p>
                      <div
                        className="mt-2 prose prose-invert max-w-none text-xs"
                        dangerouslySetInnerHTML={renderMarkdown(item.text)}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-soft">
                <h3 className="font-display text-xl font-semibold">Your Stats</h3>
                <div className="mt-5 grid gap-4">
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <span className="text-sm text-white/70">XP</span>
                    <span className="text-lg font-semibold text-gold">{xp}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <span className="text-sm text-white/70">Level</span>
                    <span className="text-lg font-semibold">{level}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <span className="text-sm text-white/70">Steps Completed</span>
                    <span className="text-lg font-semibold">{completedCount}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-soft">
                <h3 className="font-display text-xl font-semibold">Badges</h3>
                <div className="mt-5 grid grid-cols-3 gap-4">
                  {unlockedBadges.map((badge) => (
                    <div
                      key={badge.id}
                      className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center text-xs ${
                        badge.unlocked
                          ? "border-gold/60 bg-white/10 text-gold"
                          : "border-white/10 bg-white/5 text-white/40"
                      }`}
                    >
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full border ${
                          badge.unlocked ? "border-gold bg-gold/20" : "border-white/20"
                        }`}
                      >
                        <span className="text-lg">★</span>
                      </div>
                      <span>{badge.label}</span>
                      <span className="text-[10px] text-white/40">{badge.threshold} steps</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-6 shadow-soft">
                <h3 className="font-display text-xl font-semibold">Momentum Boost</h3>
                <p className="mt-2 text-sm text-white/70">
                  Keep a daily streak by completing one step every day.
                </p>
                <div className="mt-4 flex items-center gap-2">
                  {[...Array(5)].map((_, index) => (
                    <span
                      key={`streak-${index}`}
                      className={`h-3 w-3 rounded-full ${index < completedCount ? "bg-gold" : "bg-white/20"}`}
                    />
                  ))}
                </div>
              </div>
            </aside>
          </section>
        )}
      </div>
    </div>
  );
}

export default App;
