import Category from "../models/category.js";
import  Service from "../models/service.js"
import { writeAuditLog } from "../utils/auditLogger.js";
export const getCategories = async (req, res) => {
    try {

        const categories = await Category.find().sort({ displayOrder: 1 });
        res.status(200).json(categories);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching categories', error: error.message });
    }
};


export const createCategory = async (req, res) => {
    try {
        const { name, description, displayOrder, isActive } = req.body;


        const duplicate = await Category.findOne({ name });
        if (duplicate) {
            return res.status(400).json({ message: 'Category name already exists' });
        }
        const isExistingOrder = await Category.findOne({ displayOrder });
        if (isExistingOrder) {
            return res.status(400).json({ message: 'Display order must be unique' });
        }
        const newCategory = new Category({
            name,
            description,
            displayOrder,
            isActive
        });

        const savedCategory = await newCategory.save();

        await writeAuditLog({
            user: req.user,
            entity: 'category',
            entityId: savedCategory._id,
            action: 'category.created',
            description: `Created category: "${name}" (order: ${displayOrder}, active: ${isActive})`,
            after: { name, description, displayOrder, isActive },
            req,
        });

        res.status(201).json(savedCategory);
    } catch (error) {
        res.status(400).json({ message: 'Error creating category', error: error.message });
    }
};


export const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { displayOrder } = req.body;
        const isExistingOrder = await Category.findOne({ displayOrder, _id: { $ne: id } });
        if (isExistingOrder) {
            return res.status(400).json({ message: 'Display order must be unique' });
        }

        const before = await Category.findById(id).lean();

        const updatedCategory = await Category.findByIdAndUpdate(
            id,
            req.body,
            {
                returnDocument: 'after', 
                runValidators: true  
            }
        );

        if (!updatedCategory) {
            return res.status(404).json({ message: 'Category not found' });
        }

        await writeAuditLog({
            user: req.user,
            entity: 'category',
            entityId: id,
            action: 'category.updated',
            description: `Updated category: "${updatedCategory.name}"`,
            before: before ? { name: before.name, description: before.description, displayOrder: before.displayOrder, isActive: before.isActive } : null,
            after: { name: updatedCategory.name, description: updatedCategory.description, displayOrder: updatedCategory.displayOrder, isActive: updatedCategory.isActive },
            req,
        });

        res.status(200).json(updatedCategory);
    } catch (error) {
        res.status(400).json({ message: 'Error updating category', error: error.message });
    }
};



export const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const serviceExists = await Service.findOne({ category: id });
        
        if (serviceExists) {
            return res.status(400).json({ 
               message: 'This category is currently in use. Please reassign or delete the associated services first.'
            });
        }

        const deletedCategory = await Category.findByIdAndDelete(id);

        if (!deletedCategory) {
            return res.status(404).json({ message: 'Category not found' });
        }

        await writeAuditLog({
            user: req.user,
            entity: 'category',
            entityId: id,
            action: 'category.deleted',
            description: `Deleted category: "${deletedCategory.name}"`,
            before: { name: deletedCategory.name, displayOrder: deletedCategory.displayOrder },
            req,
        });

        res.status(200).json({ message: 'Category deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting category', error: error.message });
    }
};