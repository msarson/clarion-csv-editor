namespace ClarionCsvEditor
{
    partial class CsvEditorControl
    {
        private System.ComponentModel.IContainer components = null;
        private Microsoft.Web.WebView2.WinForms.WebView2 webView;

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                OnCustomDispose();
                components?.Dispose();
            }
            base.Dispose(disposing);
        }

        partial void OnCustomDispose();

        #region Component Designer generated code

        private void InitializeComponent()
        {
            this.webView = new Microsoft.Web.WebView2.WinForms.WebView2();
            ((System.ComponentModel.ISupportInitialize)(this.webView)).BeginInit();
            this.SuspendLayout();
            //
            // webView
            //
            this.webView.Dock = System.Windows.Forms.DockStyle.Fill;
            this.webView.Location = new System.Drawing.Point(0, 0);
            this.webView.Name = "webView";
            this.webView.Size = new System.Drawing.Size(600, 400);
            this.webView.TabIndex = 0;
            //
            // CsvEditorControl
            //
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 13F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.Controls.Add(this.webView);
            this.Name = "CsvEditorControl";
            this.Size = new System.Drawing.Size(600, 400);
            ((System.ComponentModel.ISupportInitialize)(this.webView)).EndInit();
            this.ResumeLayout(false);
        }

        #endregion
    }
}
