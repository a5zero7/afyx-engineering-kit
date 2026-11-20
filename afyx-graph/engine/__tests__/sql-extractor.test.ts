import { describe, it, expect } from 'vitest';
import { SqlExtractor, isSqlFile } from '../src/extraction/sql-extractor';

describe('AFYX-209: SQL Schema & Query Intelligence Extractor', () => {
  it('detects SQL files correctly', () => {
    expect(isSqlFile('schema.sql')).toBe(true);
    expect(isSqlFile('migrations/001_initial.sql')).toBe(true);
    expect(isSqlFile('V1__init.sql')).toBe(true);

    // Negative tests
    expect(isSqlFile('schema.prisma')).toBe(false);
    expect(isSqlFile('main.py')).toBe(false);
  });

  it('extracts PostgreSQL tables, columns, PK, and FK constraints with references', () => {
    const pgSql = `
-- Initial database migration
/* Multi-line comments block
   that should be ignored */

CREATE TABLE departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL
);

CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    dept_id INTEGER NOT NULL REFERENCES departments(id),
    salary NUMERIC(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_emp_dept ON employees (dept_id);

CREATE VIEW active_employees AS
SELECT e.id, e.first_name, e.last_name, d.name AS department
FROM employees e
JOIN departments d ON e.dept_id = d.id;
`;

    const extractor = new SqlExtractor('migrations/001_init.sql', pgSql);
    const result = extractor.extract();

    expect(result.errors).toHaveLength(0);

    const tableNodes = result.nodes.filter((n) => n.kind === 'class');
    const tableNames = tableNodes.map((n) => n.name);
    expect(tableNames).toContain('departments');
    expect(tableNames).toContain('employees');

    const columnNodes = result.nodes.filter((n) => n.kind === 'field');
    const columnNames = columnNodes.map((n) => n.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('dept_id');

    const columnQNames = columnNodes.map((n) => n.qualifiedName);
    expect(columnQNames).toContain('migrations/001_init.sql#departments.id');
    expect(columnQNames).toContain('migrations/001_init.sql#employees.dept_id');

    // FK reference edge: employees -> departments
    const empNode = tableNodes.find((n) => n.name === 'employees');
    const deptNode = tableNodes.find((n) => n.name === 'departments');
    expect(empNode).toBeDefined();
    expect(deptNode).toBeDefined();

    const fkEdge = result.edges.find(
      (e) => e.source === empNode?.id && e.target === deptNode?.id && e.kind === 'references'
    );
    expect(fkEdge).toBeDefined();

    // View node
    const viewNode = result.nodes.find((n) => n.kind === 'interface' && n.name === 'active_employees');
    expect(viewNode).toBeDefined();

    // Index node
    const indexNode = result.nodes.find((n) => n.kind === 'property' && n.name === 'idx_emp_dept');
    expect(indexNode).toBeDefined();
  });

  it('extracts MySQL / SQLite syntax with explicit table constraints', () => {
    const mysqlSql = `
CREATE TABLE \`orders\` (
  \`order_id\` int(11) NOT NULL AUTO_INCREMENT,
  \`customer_id\` int(11) NOT NULL,
  \`total_amount\` decimal(10,2) NOT NULL,
  PRIMARY KEY (\`order_id\`),
  CONSTRAINT \`fk_order_customer\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`)
);
`;

    const extractor = new SqlExtractor('db/orders.sql', mysqlSql);
    const result = extractor.extract();

    const orderTable = result.nodes.find((n) => n.kind === 'class' && n.name === 'orders');
    expect(orderTable).toBeDefined();

    const customerRef = result.unresolvedReferences.find((r) => r.referenceName === 'customers');
    expect(customerRef).toBeDefined();
  });

  it('handles Microsoft T-SQL GO batches and square bracket quoting', () => {
    const tsql = `
CREATE TABLE [dbo].[Customers] (
    [CustomerID] INT IDENTITY(1,1) NOT NULL,
    [CompanyName] NVARCHAR(100) NOT NULL,
    CONSTRAINT [PK_Customers] PRIMARY KEY CLUSTERED ([CustomerID] ASC)
);
GO

CREATE PROCEDURE [dbo].[GetCustomerOrders]
    @CustID INT
AS
BEGIN
    SELECT * FROM [dbo].[Orders] WHERE [CustomerID] = @CustID;
END;
GO
`;

    const extractor = new SqlExtractor('tsql/schema.sql', tsql);
    const result = extractor.extract();

    const custTable = result.nodes.find((n) => n.kind === 'class' && n.name === 'Customers');
    expect(custTable).toBeDefined();

    const procNode = result.nodes.find((n) => n.kind === 'function' && n.name === 'GetCustomerOrders');
    expect(procNode).toBeDefined();
  });

  it('handles Oracle PL/SQL slash delimiter and packages/functions', () => {
    const oracleSql = `
CREATE OR REPLACE FUNCTION get_salary_grade (p_salary IN NUMBER)
RETURN VARCHAR2
IS
  v_grade VARCHAR2(10);
BEGIN
  IF p_salary > 10000 THEN
    v_grade := 'A';
  ELSE
    v_grade := 'B';
  END IF;
  RETURN v_grade;
END;
/
`;

    const extractor = new SqlExtractor('oracle/func.sql', oracleSql);
    const result = extractor.extract();

    const funcNode = result.nodes.find((n) => n.kind === 'function' && n.name === 'get_salary_grade');
    expect(funcNode).toBeDefined();
  });
});
