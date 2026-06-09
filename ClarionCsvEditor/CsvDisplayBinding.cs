using System;
using System.Linq;
using ICSharpCode.SharpDevelop;
using ICSharpCode.SharpDevelop.Gui;

namespace ClarionCsvEditor
{
    /// <summary>
    /// Registers the CSV Editor as the handler for .csv / .tsv files.
    /// Each distinct file opens in its own editor document tab. If the same file
    /// is already open, its existing tab is reused (and activated) instead of
    /// creating a duplicate.
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
            // If this exact file is already open, hand back that tab so the IDE
            // activates it rather than opening a second copy.
            var existing = WorkbenchSingleton.Workbench.ViewContentCollection
                .OfType<CsvEditorViewContent>()
                .FirstOrDefault(vc => string.Equals(vc.FileName, fileName, StringComparison.OrdinalIgnoreCase));

            if (existing != null)
                return existing;

            // Otherwise open the file in a new editor tab of its own.
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
