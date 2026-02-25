import express from 'express';
import { 
  getCategories, 
  createCategory, 
  updateCategory, 
  deleteCategory
} from '../controllers/categoryController.js';
import {verifyToken ,verifyAdmin} from '../middleware/verifyToken.js';

const categoryRouter = express.Router();

categoryRouter.get('/', getCategories);
categoryRouter.post('/', verifyToken,verifyAdmin, createCategory);

categoryRouter.put('/:id', verifyToken,verifyAdmin, updateCategory);
categoryRouter.delete('/:id', verifyToken,verifyAdmin, deleteCategory);

export default categoryRouter;