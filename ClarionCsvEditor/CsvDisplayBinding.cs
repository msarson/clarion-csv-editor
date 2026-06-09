using System;
using System.Linq;
using ICSharpCode.SharpDevelop;
using ICSharpCode.SharpDevelop.Gui;

namespace ClarionCsvEditor
{
    /// <summary>
    /// Registers the CSV Editor as the handler for .csv / .tsv files.
    /// When a user opens such a file in the IDE, this binding routes it into
    /// the existing CSV Editor instance (as a new tab) rather than creating a
    /// separate editor per file.
    /// </summary>
    public class CsvDisplayBinding : IDisplayBinding
    {
        public bool CanCreateContentForFile(string fileName)
        {
            return fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)
                || fileName.EndsWith(".tsv", StringComparison.OrdinalIgnoreCase);
        }

        public IViewContent CreateContentForFile(string fileName)
        {
            // Reuse the existing CSV Editor instance if one is already open
            var existing = WorkbenchSingleton.Workbench.ViewContentCollection
                .OfType<CsvEditorViewContent>()
                .FirstOrDefault();

            if (existing != null)
            {
                existing.Load(fileName);
                return existing;
            }

            var content = new CsvEditorViewContent();
            content.Load(fileName);
            return content;
        }

        public bool CanCreateContentForLanguage(string languageName)
        {
            return false;
        }

        public IViewContent CreateContentForLanguage(string languageName, string content)
        {
            return null;
        }
    }
}
