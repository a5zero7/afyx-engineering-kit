import unittest
from custom_approval.models.approval_request import ApprovalRequest

class OdooApprovalTests(unittest.TestCase):
    def test_cross_company_approval_denied(self):
        req = ApprovalRequest("REQ-1", company_id=2, line_ids=[10, 11])
        with self.assertRaises(PermissionError):
            req.approve(user_company_ids=[1])
        self.assertEqual(req.state, "draft")

    def test_same_company_approval_uses_odoo16_tuple_command(self):
        req = ApprovalRequest("REQ-2", company_id=1, line_ids=[10, 11])
        res = req.approve(user_company_ids=[1])
        self.assertEqual(res["state"], "approved")
        self.assertEqual(res["commands"], [(6, 0, [10, 11])])

if __name__ == "__main__":
    unittest.main()
