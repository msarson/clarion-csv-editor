using System;
using System.IO;
using System.Windows.Forms;
using ICSharpCode.SharpDevelop.Gui;

namespace ClarionCsvEditor
{
    /// <summary>
    /// ViewContent for the CSV Editor that allows docking in the main document area,
    /// so the editor can open as a main window (like source files) rather than only
    /// as a tool pad.
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
            TitleName = "CSV Editor";
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
                    TitleName = "CSV Editor";
                    OnFileNameChanged(EventArgs.Empty);
                }
            }
        }

        public override void Load(string fileName)
        {
            _fileName = fileName;
            TitleName = "CSV Editor";
            if (_control != null && File.Exists(fileName))
                _control.LoadFile(fileName);
            OnFileNameChanged(EventArgs.Empty);
        }

        public override void Save(string fileName)
        {
            if (!string.IsNullOrEmpty(fileName))
            {
                _control?.SaveFile();
                _fileName = fileName;
                TitleName = "CSV Editor";
                IsDirty = false;
                OnFileNameChanged(EventArgs.Empty);
            }
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
