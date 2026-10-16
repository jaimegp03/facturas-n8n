# Abre en Excel real (COM) los .xlsx de tests/salida/excel_web: sin reparación, 0 errores de celda, y exporta cada uno a PDF.
param([string[]]$Archivos = @('Gastos_demo.xlsx', 'libro.xlsx', 'asientos.xlsx'))
$dir = Join-Path $PSScriptRoot 'salida\excel_web'
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  foreach ($a in $Archivos) {
    $f = Join-Path $dir $a
    $wb = $xl.Workbooks.Open($f, 0, $true)
    $xl.CalculateFull()
    $err = 0; $info = @()
    foreach ($ws in $wb.Worksheets) {
      $ur = $ws.UsedRange
      foreach ($c in $ur.Cells) { if ($c.Value2 -is [int] -and $c.Text -like '#*') { $err++ } elseif ($c.Text -like '#N/A*' -or $c.Text -like '#VALUE*' -or $c.Text -like '#REF*' -or $c.Text -like '#NAME*' -or $c.Text -like '#DIV*') { $err++ } }
      $info += ('{0}:{1} filas' -f $ws.Name, $ur.Rows.Count)
    }
    $pdf = [IO.Path]::ChangeExtension($f, 'pdf')
    $wb.ExportAsFixedFormat(0, $pdf)
    Write-Output ('{0}: abre sin reparación; errores={1}; hojas=[{2}]; PDF={3}' -f $a, $err, ($info -join ', '), (Split-Path $pdf -Leaf))
    $wb.Close($false)
  }
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
