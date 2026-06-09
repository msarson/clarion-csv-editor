using System;
using System.Linq;
using ICSharpCode.Core;
using ICSharpCode.SharpDevelop.Gui;

namespace ClarionCsvEditor
{
    /// <summary>
    /// Command to show the CSV Editor as a main window (document view), so it can
    /// be docked in the main document area.
    /// </summary>
    public class ShowCsvEditorWindowCommand : AbstractMenuCommand
    {
        public override void Run()
        {
            try
            {
                var workbench = WorkbenchSingleton.Workbench;
                if (workbench == null) return;

                var existing = workbench.ViewContentCollection
                    .OfType<CsvEditorViewContent>()
                    .FirstOrDefault();

                if (existing != null)
                {
                    existing.WorkbenchWindow?.SelectWindow();
                    return;
                }

                var viewContent = new CsvEditorViewContent();

                var showViewMethod = workbench.GetType().GetMethod("ShowView",
                    new Type[] { typeof(IViewContent) });

                if (showViewMethod != null)
                {
                    showViewMethod.Invoke(workbench, new object[] { viewContent });
                }
                else
                {
                    var viewContentsProp = workbench.GetType().GetProperty("ViewContentCollection");
                    if (viewContentsProp != null)
                    {
                        var collection = viewContentsProp.GetValue(workbench, null);
                        if (collection != null)
                        {
                            var addMethod = collection.GetType().GetMethod("Add",
                                new Type[] { typeof(IViewContent) });
                            addMethod?.Invoke(collection, new object[] { viewContent });
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                System.Windows.Forms.MessageBox.Show(
                    "Error opening CSV Editor window: " + ex.Message,
                    "CSV Editor",
                    System.Windows.Forms.MessageBoxButtons.OK,
                    System.Windows.Forms.MessageBoxIcon.Error);
            }
        }
    }
}
