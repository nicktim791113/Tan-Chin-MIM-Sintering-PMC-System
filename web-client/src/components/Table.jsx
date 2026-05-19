export function Table({ columns = [], data = [], keyField = 'id', emptyMsg = "目前沒有資料" }) {
  return (
    <div className="table-responsive">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col, idx) => (
              <th key={idx}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-4 text-secondary">
                {emptyMsg}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr key={row[keyField] || i}>
                {columns.map((col, idx) => (
                  <td key={idx}>{col.render ? col.render(row) : row[col.field]}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
