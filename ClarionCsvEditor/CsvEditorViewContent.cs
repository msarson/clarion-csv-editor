using System;
using System.IO;
using System.Windows.Forms;
using ICSharpCode.SharpDevelop.Gui;

namespace ClarionCsvEditor
{
    /// <summary>
    /// ViewContent for the CSV Editor — a first-class IDE document. It participates
    /// in the native File menu: File &gt; Open routes here via the display binding,
    /// and File &gt; Save / Save As call Save(string). The dirty '*' and close
    /// prompts are driven by IsDirty.
    /// </summary>
    public class CsvEditorViewContent : AbstractViewContent
    {
        private CsvEditorControl _control;
        private string _fileName;
        private bool _isDirty;

        public CsvEditorViewContent()
        {
            _control = new CsvEditorControl();
            _control.DirtyChanged += (s, e) => IsDirty = _control.IsDirty;
            // A Save As driven from inside the editor (toolbar) can change the path;
            // mirror it onto the tab.
            _control.FileNameChanged += newPath => FileName = newPath;
            TitleName = "CSV Editor";
        }

        /// <summary>Tab title: the open file's name, or a default when nothing is loaded.</summary>
        private static string TitleFor(string fileName)
        {
            return string.IsNullOrEmpty(fileName) ? "CSV Editor" : Path.GetFileName(fileName);
        }

        public override Control Control
        {
            get { return _control; }
        }

        public override bool IsDirty
        {
            get { return _isDirty; }
            set
            {
                if (_isDirty != value)
                {
                    _isDirty = value;
                    OnDirtyChanged(EventArgs.Empty);
                }
            }
        }

        public override string FileName
        {
            get { return _fileName; }
            set
            {
                if (_fileName != value)
                {
                    _fileName = value;
                    TitleName = TitleFor(value);
                    OnFileNameChanged(EventArgs.Empty);
                }
            }
        }

        public override void Load(string fileName)
        {
            _fileName = fileName;
            TitleName = TitleFor(fileName);
            if (_control != null && File.Exists(fileName))
                _control.LoadFile(fileName);
            OnFileNameChanged(EventArgs.Empty);
        }

        /// <summary>
        /// Called by the IDE's File &gt; Save and File &gt; Save As (the latter with a
        /// new path). Writes the current grid content and updates the tab to match.
        /// </summary>
        public override void Save(string fileName)
        {
            if (string.IsNullOrEmpty(fileName)) return;

            _control?.SaveToFile(fileName);   // throws on I/O error -> IDE reports it
            _fileName = fileName;
            TitleName = TitleFor(fileName);
            IsDirty = false;
            OnFileNameChanged(EventArgs.Empty);
        }

        public override void Dispose()
        {
            if (_control != null)
            {
                _control.Dispose();
                _control = null;
            }
            base.Dispose();
        }

        public override void RedrawContent()
        {
            _control?.Refresh();
        }
    }
}
