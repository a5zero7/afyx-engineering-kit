from source import pay
from source import refund as imported_refund


def invoke():
    return pay()


def invoke_alias():
    return imported_refund()
