// Copyright (c) 2014 CCP ehf. Source port of blue/src/XUtil.cpp119-212,
// under clientPreferences-LICENSE.txt. Shipped3396210 0x180334440 uses
// PyString_Type (not current source Unicode) and DBRow::SequenceGet directly.
// No Blue scheduler/CanYield/virtual pre-Yield call is fabricated here. The
// first possibly yielding checkpoint is an explicit unavailable continuation.
static PyObject* rowset_index(PyObject* owner, PyObject* args) {
  PyObject *rows, *key_name, *dictionary, *key = NULL, *row = NULL, *answer = NULL;
  PyObject* row_type = PyTuple_GetItem(owner, 0), *getter = PyTuple_GetItem(owner, 1);
  if (!PyArg_ParseTuple(args, "O!O!O!:XUtil_Index", list_type, &rows, str_type, &key_name, dict_type, &dictionary)) return NULL;
  if (!PyList_Size(rows)) { Py_IncRef(dictionary); return dictionary; }
  row = PyList_GetItem(rows, 0); if (!row) return NULL;
  int admitted = PyObject_IsInstance(row, row_type); if (admitted < 0) return NULL;
  if (!admitted) { PyErr_SetString(*exc_runtime, "XUtil_Index: Row in rowset must be of type DBRow"); return NULL; }
  PyObject* keys = PyObject_GetAttrString(row, "__keys__"); if (!keys) return NULL;
  Py_ssize_t column = PySequence_Index(keys, key_name); decref(keys);
  if (column < 0) {
    char* name; Py_ssize_t size;
    if (PyString_AsStringAndSize(key_name, &name, &size)) return NULL;
    PyErr_Format(*exc_runtime, "XUtil_Index: Invalid column name '%s'.", name); return NULL;
  }
  row = NULL;
  for (Py_ssize_t i = 0; i < PyList_Size(rows); ++i) {
    row = PyList_GetItem(rows, i); if (!row) goto done;
    admitted = PyObject_IsInstance(row, row_type); if (admitted < 0) { row = NULL; goto done; }
    if (!admitted) { row = NULL; continue; }
    // Own the row across its original virtual getter. A callback removing its
    // borrowed current row would make native continuation unsafe; refuse it.
    Py_IncRef(row);
    PyObject *call = PyTuple_New(2), *index = PyInt_FromLong((long)column);
    if (!call || !index) { decref(call); decref(index); goto done; }
    Py_IncRef(row); PyTuple_SetItem(call, 0, row); PyTuple_SetItem(call, 1, index);
    key = PyObject_CallObject(getter, call); decref(call); if (!key) goto done;
    if (i >= PyList_Size(rows) || PyList_GetItem(rows, i) != row) {
      PyErr_SetString(PyTuple_GetItem(owner, 2), "Removing the current row during native indexing is outside this capability");
      goto done;
    }
    if (PyDict_SetItem(dictionary, key, row) < 0) goto done;
    decref(key); key = NULL;
    if ((i + 1) % 25000 == 0) {
      PyErr_SetString(PyTuple_GetItem(owner, 2), "Native XUtil_Index scheduling checkpoint requires the real yielding owner");
      goto done;
    }
    decref(row); row = NULL;
  }
  Py_IncRef(dictionary); answer = dictionary;
done:
  decref(key); decref(row); return answer;
}
static PyMethodDef rowset_index_method = {"XUtil_Index", rowset_index, 1, "Named native row index source port; yielding continuation unavailable."};
static PyObject* row_indexer(PyObject* ignored, PyObject* args) {
  if (PyTuple_Size(args) != 3) { PyErr_SetString(*exc_type, "Row indexer requires the actual row type, sequence getter and domain error"); return NULL; }
  return PyCFunction_NewEx(&rowset_index_method, args, NULL);
}
