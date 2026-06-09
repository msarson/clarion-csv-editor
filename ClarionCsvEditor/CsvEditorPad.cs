using System.Windows.Forms;
using ICSharpCode.SharpDevelop.Gui;

namespace ClarionCsvEditor
{
    /// <summary>
    /// Dockable pad for the CSV file viewer and editor.
    /// </summary>
    public class CsvEditorPad : AbstractPadContent
    {
        private CsvEditorControl _control;

        public override Control Control
        {
            get
            {
                if (_control == null)
                {
                    _control = new CsvEditorControl();
                }
                return _control;
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
