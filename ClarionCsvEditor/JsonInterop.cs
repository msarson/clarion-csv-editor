using System;

namespace ClarionCsvEditor
{
    /// <summary>
    /// Small, dependency-free helpers for the flat JSON / JSON-string-literal payloads
    /// exchanged with the WebView2 page. Kept out of <see cref="CsvEditorControl"/> (which
    /// drags in WinForms + WebView2) so the fiddly escape handling can be unit tested in
    /// isolation. Not a general-purpose JSON parser.
    /// </summary>
    public static class JsonInterop
    {
        /// <summary>
        /// Extracts a top-level string/bool value for <paramref name="key"/> from a small
        /// JSON object. Good enough for the flat { "type": ..., "isDark": ... } messages
        /// this control receives; not a general-purpose parser.
        /// </summary>
        public static string ExtractJsonValue(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var token = "\"" + key + "\"";
            int k = json.IndexOf(token, StringComparison.Ordinal);
            if (k < 0) return null;
            int colon = json.IndexOf(':', k + token.Length);
            if (colon < 0) return null;

            int i = colon + 1;
            while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
            if (i >= json.Length) return null;

            if (json[i] == '"')
            {
                int end = i + 1;
                var sb = new System.Text.StringBuilder();
                while (end < json.Length && json[end] != '"')
                {
                    if (json[end] == '\\' && end + 1 < json.Length)
                    {
                        end++;
                        switch (json[end])
                        {
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            default: sb.Append(json[end]); break;
                        }
                    }
                    else sb.Append(json[end]);
                    end++;
                }
                return sb.ToString();
            }

            int valEnd = i;
            while (valEnd < json.Length && json[valEnd] != ',' && json[valEnd] != '}') valEnd++;
            return json.Substring(i, valEnd - i).Trim();
        }

        /// <summary>
        /// Decodes a complete JSON string literal (including the surrounding quotes)
        /// back to text, handling every escape — \n \r \t \" \\ \/ \b \f and \uXXXX —
        /// so non-ASCII content (e.g. "Sørensen") survives the round-trip through
        /// WebMessageAsJson. Returns the input unchanged if it isn't a quoted literal.
        /// </summary>
        public static string DecodeJsonString(string json)
        {
            if (string.IsNullOrEmpty(json)) return json;
            if (json == "null") return null;
            if (json.Length < 2 || json[0] != '"' || json[json.Length - 1] != '"')
                return json;

            var sb = new System.Text.StringBuilder(json.Length - 2);
            int i = 1;
            int end = json.Length - 1;
            while (i < end)
            {
                char c = json[i];
                if (c != '\\')
                {
                    sb.Append(c);
                    i++;
                    continue;
                }
                if (i + 1 >= end)
                {
                    sb.Append(c);
                    i++;
                    continue;
                }
                char esc = json[i + 1];
                switch (esc)
                {
                    case '"': sb.Append('"'); i += 2; break;
                    case '\\': sb.Append('\\'); i += 2; break;
                    case '/': sb.Append('/'); i += 2; break;
                    case 'b': sb.Append('\b'); i += 2; break;
                    case 'f': sb.Append('\f'); i += 2; break;
                    case 'n': sb.Append('\n'); i += 2; break;
                    case 'r': sb.Append('\r'); i += 2; break;
                    case 't': sb.Append('\t'); i += 2; break;
                    case 'u':
                        if (i + 6 <= end &&
                            int.TryParse(json.Substring(i + 2, 4),
                                System.Globalization.NumberStyles.HexNumber,
                                System.Globalization.CultureInfo.InvariantCulture,
                                out int codeUnit))
                        {
                            sb.Append((char)codeUnit);
                            i += 6;
                        }
                        else
                        {
                            sb.Append(esc);
                            i += 2;
                        }
                        break;
                    default:
                        sb.Append(esc);
                        i += 2;
                        break;
                }
            }
            return sb.ToString();
        }
    }
}
