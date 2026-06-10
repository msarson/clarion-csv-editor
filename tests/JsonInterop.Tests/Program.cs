using System;
using ClarionCsvEditor;

int failures = 0;

string Show(string s) => s == null ? "null" : "\"" + s.Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t") + "\"";

void Eq(string name, string actual, string expected)
{
    bool ok = actual == expected;
    if (!ok) failures++;
    Console.WriteLine((ok ? "PASS " : "FAIL ") + name + (ok ? "" : $"  (got {Show(actual)}, want {Show(expected)})"));
}

// --- DecodeJsonString: WebMessageAsJson string-literal channel (CSV snapshots) ---
Eq("decode plain string", JsonInterop.DecodeJsonString("\"hello\""), "hello");
Eq("decode \\n and \\t escapes", JsonInterop.DecodeJsonString("\"a\\nb\\tc\""), "a\nb\tc");
Eq("decode \\uXXXX (Sørensen)", JsonInterop.DecodeJsonString("\"S\\u00f8rensen\""), "Sørensen");
Eq("decode quote + backslash", JsonInterop.DecodeJsonString("\"a\\\"b\\\\c\""), "a\"b\\c");
Eq("decode null literal -> null", JsonInterop.DecodeJsonString("null"), null);
Eq("decode non-literal passthrough", JsonInterop.DecodeJsonString("{\"x\":1}"), "{\"x\":1}");

// --- ExtractJsonValue: flat control messages { type, dirty, isDark } ---
Eq("extract type", JsonInterop.ExtractJsonValue("{\"type\":\"saveRequested\"}", "type"), "saveRequested");
Eq("extract bool value", JsonInterop.ExtractJsonValue("{\"type\":\"dirtyChanged\",\"dirty\":true}", "dirty"), "true");
Eq("extract missing key -> null", JsonInterop.ExtractJsonValue("{\"type\":\"x\"}", "dirty"), null);
Eq("extract escaped string value", JsonInterop.ExtractJsonValue("{\"v\":\"a\\nb\"}", "v"), "a\nb");

Console.WriteLine(failures == 0 ? "\nALL PASS" : $"\n{failures} FAILED");
return failures == 0 ? 0 : 1;
